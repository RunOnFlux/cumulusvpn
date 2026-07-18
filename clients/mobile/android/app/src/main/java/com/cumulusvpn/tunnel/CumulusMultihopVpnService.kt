package com.cumulusvpn.tunnel

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import com.cumulusvpn.wgnest.wgmobile.Wgmobile
import java.net.InetAddress

/**
 * VpnService that runs the genuinely nested (multi-hop) tunnel.
 *
 * Unlike single-hop (which the stock [GoBackend] owns end-to-end), true nesting
 * needs TWO stacked wireguard-go devices where the inner device's UDP socket is
 * a connection on the outer device's netstack. That lives in the userspace
 * `wgnest` core, bound to Android via the [Wgmobile] AAR. This service exists
 * only to own the OS tun: it builds it, establishes it, and hands the raw fd to
 * `Wgmobile.start`, which wires it as the inner device's tun.
 *
 * **Why split routing instead of `protect()`**: the outer device holds the one
 * real UDP socket, to the ENTRY gateway. If the VPN captured that socket's
 * traffic it would loop forever. Rather than plumb a `protect()` hook down into
 * the Go bind, we simply route `0.0.0.0/0` MINUS the entry IP into the tun — so
 * the single socket to the entry bypasses the VPN, and everything else is
 * tunneled. This keeps `wgnest` fully platform-agnostic.
 */
class CumulusMultihopVpnService : VpnService() {

    private var tun: ParcelFileDescriptor? = null

    @Volatile
    private var handle: Long = 0

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                teardown()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val startIntent = intent ?: return START_NOT_STICKY
                // Bring the nested tunnel up OFF the main thread: it wraps the tun
                // fd and starts two wireguard-go devices via JNI, which must not
                // block the main looper (ANR / process freeze).
                Thread {
                    try {
                        connect(startIntent)
                        CumulusTunnelController.onMultihopState(CumulusTunnelController.STATE_CONNECTED)
                    } catch (t: Throwable) {
                        Log.e(TAG, "multihop connect failed", t)
                        teardown()
                        CumulusTunnelController.onMultihopState(CumulusTunnelController.STATE_ERROR)
                        stopSelf()
                    }
                }.start()
                return START_NOT_STICKY
            }
        }
    }

    private fun connect(intent: Intent) {
        val clientPriv = intent.req(EXTRA_CLIENT_PRIV)
        val entryPub = intent.req(EXTRA_ENTRY_PUB)
        val entryIp = intent.req(EXTRA_ENTRY_IP)
        val entryAssigned = intent.req(EXTRA_ENTRY_ASSIGNED)
        val exitPub = intent.req(EXTRA_EXIT_PUB)
        val exitIp = intent.req(EXTRA_EXIT_IP)
        val exitAssigned = intent.req(EXTRA_EXIT_ASSIGNED)
        val exitDns = intent.getStringExtra(EXTRA_EXIT_DNS) ?: "1.1.1.1"

        // Inner tun: the exit-assigned address, exit DNS, room for two WG headers.
        val builder = Builder()
            .setSession("CumulusVPN")
            .addAddress(exitAssigned, 32)
            .addDnsServer(exitDns)
            .setMtu(1340)
            .setBlocking(true)
        // Route everything EXCEPT the entry gateway IP into the tun, so the
        // outer device's real socket to the entry bypasses the VPN (no loop).
        for ((net, prefix) in routesExcluding(entryIp)) {
            builder.addRoute(net, prefix)
        }

        val pfd = builder.establish()
            ?: throw IllegalStateException("VPN establish() returned null — consent revoked?")
        tun = pfd

        // detachFd: hand sole ownership of the fd to the Go tun, which closes it
        // on Wgmobile.stop. (Keeping the pfd too would double-close.)
        val fd = pfd.detachFd()
        handle = Wgmobile.start(
            clientPriv,
            entryPub, entryIp, entryAssigned,
            exitPub, exitIp, exitAssigned,
            fd.toLong(),
        )
        Log.i(TAG, "nested tunnel up: entry=$entryIp exit=$exitIp handle=$handle")
    }

    private fun teardown() {
        val h = handle
        handle = 0
        if (h != 0L) {
            try {
                Wgmobile.stop(h)
            } catch (t: Throwable) {
                Log.e(TAG, "Wgmobile.stop failed", t)
            }
        }
        // The Go tun owns the fd via detachFd; if establish() failed before that,
        // close whatever pfd we still hold.
        try {
            tun?.close()
        } catch (_: Throwable) {
        }
        tun = null
    }

    override fun onDestroy() {
        teardown()
        CumulusTunnelController.onMultihopState(CumulusTunnelController.STATE_DISCONNECTED)
        super.onDestroy()
    }

    override fun onRevoke() {
        // The OS or another VPN app revoked us.
        teardown()
        CumulusTunnelController.onMultihopState(CumulusTunnelController.STATE_DISCONNECTED)
        stopSelf()
        super.onRevoke()
    }

    companion object {
        private const val TAG = "CumulusMultihop"

        const val ACTION_START = "com.cumulusvpn.multihop.START"
        const val ACTION_STOP = "com.cumulusvpn.multihop.STOP"

        const val EXTRA_CLIENT_PRIV = "clientPriv"
        const val EXTRA_ENTRY_PUB = "entryPub"
        const val EXTRA_ENTRY_IP = "entryIp"
        const val EXTRA_ENTRY_ASSIGNED = "entryAssigned"
        const val EXTRA_EXIT_PUB = "exitPub"
        const val EXTRA_EXIT_IP = "exitIp"
        const val EXTRA_EXIT_ASSIGNED = "exitAssigned"
        const val EXTRA_EXIT_DNS = "exitDns"

        private fun Intent.req(key: String): String =
            getStringExtra(key) ?: throw IllegalArgumentException("missing extra: $key")

        /**
         * The set of CIDR routes covering `0.0.0.0/0` EXCEPT [excludeIp]`/32`.
         * Classic "all IPs but one": at each prefix length 1..32, add the sibling
         * subnet that cannot contain the target. 32 routes, union = everything
         * minus the target /32.
         */
        fun routesExcluding(excludeIp: String): List<Pair<String, Int>> {
            val bytes = InetAddress.getByName(excludeIp).address
            val ip = ((bytes[0].toLong() and 0xff) shl 24) or
                ((bytes[1].toLong() and 0xff) shl 16) or
                ((bytes[2].toLong() and 0xff) shl 8) or
                (bytes[3].toLong() and 0xff)
            val out = ArrayList<Pair<String, Int>>(32)
            for (prefix in 1..32) {
                val hostBits = 32 - prefix
                val bit = 1L shl hostBits
                val mask = (0xFFFFFFFFL shl hostBits) and 0xFFFFFFFFL
                val network = (ip xor bit) and mask
                out.add(longToIp(network) to prefix)
            }
            return out
        }

        private fun longToIp(v: Long): String =
            "${(v ushr 24) and 0xff}.${(v ushr 16) and 0xff}.${(v ushr 8) and 0xff}.${v and 0xff}"
    }
}
