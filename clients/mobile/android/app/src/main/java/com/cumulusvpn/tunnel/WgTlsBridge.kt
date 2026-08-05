package com.cumulusvpn.tunnel

import android.util.Log
import java.io.DataInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Client side of the `wg-tls` transport on Android: a local UDP <-> TLS bridge.
 *
 * WireGuard-over-TLS makes the tunnel ride an ordinary-looking TLS session so it
 * survives both the vanilla-WG DPI fingerprint AND UDP/port blocking — the one
 * thing the AmneziaWG (`awg`) transport can't do, since it's still UDP
 * (docs/15-transports.md).
 *
 * The wgnest WireGuard device dials our LOCAL loopback UDP socket (its peer
 * Endpoint); we frame each datagram with a 2-byte big-endian length prefix
 * (matching gateway/internal/tlsrelay) and tunnel it over ONE [SSLSocket] to the
 * gateway relay. Replies come back over TLS and are delivered to the WG device as
 * UDP. This is the Android mirror of the Go `tlsrelay.ClientBridge`, the desktop
 * Rust bridge, and the iOS `WgTlsBridge`.
 *
 * The bridge's TLS socket connects to the gateway IP, which the VpnService routes
 * OUTSIDE the tun (the same 0.0.0.0/0-minus-gateway exclusion the obfs/multi-hop
 * services use for their WG socket), so it doesn't loop back through the tunnel.
 *
 * SECURITY: the TLS layer is OBFUSCATION ONLY — the cert is not verified (the
 * trust manager accepts everything). Trust is anchored entirely in the inner
 * WireGuard handshake, so a TLS MITM still can't complete the inner WG handshake.
 */
class WgTlsBridge {

    private var udp: DatagramSocket? = null
    private var tls: SSLSocket? = null

    @Volatile
    private var running = false

    // The WG device's UDP source, learned from its first datagram, so TLS replies
    // are delivered back to it.
    @Volatile
    private var wgSource: InetSocketAddress? = null

    /**
     * Connect to the gateway relay at [relayHost]:[relayPort] over TLS and bind a
     * local loopback UDP socket. Returns the local UDP port the WG device must
     * dial. Throws on connect/handshake failure.
     */
    fun start(relayHost: String, relayPort: Int, sni: String): Int {
        val udpSock = DatagramSocket(0, InetAddress.getByName("127.0.0.1"))
        udp = udpSock
        val localPort = udpSock.localPort

        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf<TrustManager>(TrustAll()), SecureRandom())
        val sock = ctx.socketFactory.createSocket() as SSLSocket
        // Present an SNI when we have a plausible hostname (SNIHostName rejects raw
        // IPs); camouflage only, never verified.
        if (sni.isNotEmpty()) {
            try {
                val params = sock.sslParameters
                params.serverNames = listOf(SNIHostName(sni))
                sock.sslParameters = params
            } catch (t: Throwable) {
                Log.w(TAG, "invalid SNI '$sni', connecting without one", t)
            }
        }
        // Publish the socket BEFORE the (blocking) handshake so stop() can reach
        // it — otherwise a teardown during the handshake has nothing to close.
        tls = sock
        sock.connect(InetSocketAddress(relayHost, relayPort), CONNECT_TIMEOUT_MS)
        // startHandshake() blocks with NO timeout of its own: a relay that accepts
        // TCP and then never speaks TLS (exactly what a censor doing selective
        // blackholing looks like) would wedge this thread and leak the socket —
        // once per wg-tls attempt, and the fallback loop makes several. SO_TIMEOUT
        // bounds the handshake reads; it is cleared afterwards because the pump
        // threads must block indefinitely on a healthy idle tunnel.
        sock.soTimeout = HANDSHAKE_TIMEOUT_MS
        try {
            sock.startHandshake()
        } catch (t: Throwable) {
            try {
                sock.close()
            } catch (_: Throwable) {
            }
            tls = null
            throw t
        }
        sock.soTimeout = 0

        running = true
        Thread({ pumpUdpToTls(udpSock, sock) }, "wg-tls-udp2tls").start()
        Thread({ pumpTlsToUdp(sock, udpSock) }, "wg-tls-tls2udp").start()
        Log.i(TAG, "wg-tls bridge up: relay=$relayHost:$relayPort local=$localPort")
        return localPort
    }

    /** Tear both sides down. Idempotent; unblocks the pump threads. */
    fun stop() {
        running = false
        try {
            tls?.close()
        } catch (_: Throwable) {
        }
        try {
            udp?.close()
        } catch (_: Throwable) {
        }
        tls = null
        udp = null
    }

    // UDP (WG device) -> TLS (gateway relay): frame each datagram and forward.
    private fun pumpUdpToTls(udp: DatagramSocket, tls: SSLSocket) {
        val buf = ByteArray(MAX_DATAGRAM)
        try {
            val out = tls.outputStream
            while (running) {
                val pkt = DatagramPacket(buf, buf.size)
                udp.receive(pkt)
                wgSource = InetSocketAddress(pkt.address, pkt.port)
                val n = pkt.length
                val frame = ByteArray(2 + n)
                frame[0] = (n ushr 8).toByte()
                frame[1] = n.toByte()
                System.arraycopy(buf, 0, frame, 2, n)
                out.write(frame)
                out.flush()
            }
        } catch (t: Throwable) {
            if (running) Log.w(TAG, "wg-tls udp->tls ended", t)
        } finally {
            stop()
        }
    }

    // TLS (gateway relay) -> UDP (WG device): de-frame the stream, deliver each
    // datagram back to the WG device's source.
    private fun pumpTlsToUdp(tls: SSLSocket, udp: DatagramSocket) {
        val hdr = ByteArray(2)
        try {
            val inp = DataInputStream(tls.inputStream)
            while (running) {
                inp.readFully(hdr)
                val len = ((hdr[0].toInt() and 0xff) shl 8) or (hdr[1].toInt() and 0xff)
                val pkt = ByteArray(len)
                inp.readFully(pkt)
                val dst = wgSource
                if (dst != null) {
                    udp.send(DatagramPacket(pkt, len, dst.address, dst.port))
                }
            }
        } catch (t: Throwable) {
            if (running) Log.w(TAG, "wg-tls tls->udp ended", t)
        } finally {
            stop()
        }
    }

    /** Accept any server certificate — the TLS layer is camouflage only. */
    private class TrustAll : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

    companion object {
        private const val TAG = "WgTlsBridge"
        private const val MAX_DATAGRAM = 65535
        private const val CONNECT_TIMEOUT_MS = 10000
        /** Bounds the TLS handshake reads; see start(). Cleared once connected. */
        private const val HANDSHAKE_TIMEOUT_MS = 10000
    }
}
