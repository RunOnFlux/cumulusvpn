package com.cumulusvpn.tunnel

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.cumulusvpn.wgnest.wgmobile.Wgmobile

/**
 * VpnService that runs an OBFUSCATED (AmneziaWG) single-hop tunnel through the
 * userspace `wgnest` core — the data plane for Stealth mode on Android.
 *
 * Vanilla single-hop stays on the stock wireguard-android [GoBackend] (unchanged
 * for existing users). This path exists ONLY when a config carries AmneziaWG
 * `[Interface]` params, which the official `Config` parser cannot represent, so
 * the controller routes those configs here instead. Structurally this is the
 * multi-hop service with ONE device.
 *
 * Like the outer multi-hop device, the single obfs device holds one real UDP
 * socket to the gateway, so we route `0.0.0.0/0` MINUS the gateway IP into the
 * tun — that socket bypasses the VPN, everything else is tunneled.
 */
class CumulusObfsVpnService : VpnService() {

    private var tun: ParcelFileDescriptor? = null

    // wg-tls transport: the UDP<->TLS bridge, kept for the session. null for awg.
    private var tlsBridge: WgTlsBridge? = null

    @Volatile
    private var handle: Long = 0

    @Volatile
    private var stopRequested = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopRequested = true
                teardown()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val startIntent = intent ?: return START_NOT_STICKY
                stopRequested = false
                startForegroundNotification()
                // Bring the tunnel up OFF the main thread (JNI + device start must
                // not block the looper).
                Thread {
                    try {
                        connect(startIntent)
                        if (stopRequested) {
                            teardown()
                            CumulusTunnelController.onObfsState(CumulusTunnelController.STATE_DISCONNECTED)
                            stopSelf()
                        } else {
                            CumulusTunnelController.onObfsState(CumulusTunnelController.STATE_CONNECTED)
                        }
                    } catch (t: Throwable) {
                        Log.e(TAG, "obfs connect failed", t)
                        teardown()
                        CumulusTunnelController.onObfsState(CumulusTunnelController.STATE_ERROR)
                        stopSelf()
                    }
                }.start()
                return START_NOT_STICKY
            }
        }
    }

    private fun connect(intent: Intent) {
        val clientPriv = intent.req(EXTRA_CLIENT_PRIV)
        val serverPub = intent.req(EXTRA_SERVER_PUB)
        val serverIp = intent.req(EXTRA_SERVER_IP)
        val serverAssigned = intent.req(EXTRA_SERVER_ASSIGNED)
        val port = intent.getIntExtra(EXTRA_PORT, 0)
        val obfs = intent.getStringExtra(EXTRA_OBFS) ?: ""
        val dns = intent.getStringExtra(EXTRA_DNS) ?: "1.1.1.1"
        // wg-tls: when a TLS relay + SNI are present, the WG device dials a local
        // bridge instead of the gateway directly.
        val tlsRelay = intent.getStringExtra(EXTRA_TLS_RELAY)
        val tlsSni = intent.getStringExtra(EXTRA_TLS_SNI)

        val builder = Builder()
            .setSession("CumulusVPN")
            .addAddress(serverAssigned, 32)
            .addDnsServer(dns)
            .setMtu(1420)
            .setBlocking(true)
        // Route everything EXCEPT the gateway IP into the tun, so the device's one
        // real socket to the gateway bypasses the VPN (no loop). Reuses the
        // multi-hop service's route arithmetic.
        for ((net, prefix) in CumulusMultihopVpnService.routesExcluding(serverIp)) {
            builder.addRoute(net, prefix)
        }
        // Blackhole IPv6 into the tun so v6 can't leak past the VPN.
        try {
            builder.addRoute("::", 0)
        } catch (t: Throwable) {
            Log.w(TAG, "could not add IPv6 blackhole route", t)
        }

        val pfd = builder.establish()
            ?: throw IllegalStateException("VPN establish() returned null — consent revoked?")
        tun = pfd

        val fd = pfd.detachFd()

        // For wg-tls, stand up the UDP<->TLS bridge to the gateway relay (its TCP
        // socket bypasses the tun via the gateway-IP route exclusion above) and
        // point the WG device at 127.0.0.1:<bridgePort> with NO obfs (the TLS
        // wrapper is the obfuscation). Otherwise the WG device dials the gateway
        // directly (vanilla awg over UDP).
        var wgServerIp = serverIp
        var wgPort = port
        var wgObfs = obfs
        if (tlsSni != null && tlsRelay != null) {
            val (relayHost, relayPort) = splitHostPort(tlsRelay)
            val bridge = WgTlsBridge()
            tlsBridge = bridge
            val localPort = bridge.start(relayHost, relayPort, tlsSni)
            wgServerIp = "127.0.0.1"
            wgPort = localPort
            wgObfs = ""
        }

        handle = Wgmobile.startSingle(
            clientPriv, serverPub, wgServerIp, serverAssigned,
            fd.toLong(), wgPort.toLong(), wgObfs,
        )
        activeHandle = handle
        Log.i(TAG, "wgnest single-hop up: server=$wgServerIp:$wgPort tls=${tlsSni != null} handle=$handle")
    }

    private fun teardown() {
        val h = handle
        handle = 0
        activeHandle = 0
        if (h != 0L) {
            try {
                Wgmobile.stop(h)
            } catch (t: Throwable) {
                Log.e(TAG, "Wgmobile.stop failed", t)
            }
        }
        try {
            tlsBridge?.stop()
        } catch (_: Throwable) {
        }
        tlsBridge = null
        try {
            tun?.close()
        } catch (_: Throwable) {
        }
        tun = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    }

    /** Split `host:port` (IPv4 gateway literals); default to the WG port if absent. */
    private fun splitHostPort(hostPort: String): Pair<String, Int> {
        val colon = hostPort.lastIndexOf(':')
        if (colon <= 0) return hostPort to 51820
        val host = hostPort.substring(0, colon)
        val port = hostPort.substring(colon + 1).toIntOrNull() ?: 51820
        return host to port
    }

    private fun startForegroundNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                NOTIF_CHANNEL,
                "VPN status",
                NotificationManager.IMPORTANCE_LOW,
            )
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
        }
        val notif = NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setContentTitle("CumulusVPN")
            .setContentText("Stealth tunnel active")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
        val type =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                0
            }
        ServiceCompat.startForeground(this, NOTIF_ID, notif, type)
    }

    override fun onDestroy() {
        teardown()
        CumulusTunnelController.onObfsState(CumulusTunnelController.STATE_DISCONNECTED)
        super.onDestroy()
    }

    override fun onRevoke() {
        teardown()
        CumulusTunnelController.onObfsState(CumulusTunnelController.STATE_DISCONNECTED)
        stopSelf()
        super.onRevoke()
    }

    companion object {
        private const val TAG = "CumulusObfs"
        private const val NOTIF_CHANNEL = "cumulusvpn.vpn"
        private const val NOTIF_ID = 1002

        const val ACTION_START = "com.cumulusvpn.obfs.START"
        const val ACTION_STOP = "com.cumulusvpn.obfs.STOP"
        const val EXTRA_CLIENT_PRIV = "clientPriv"
        const val EXTRA_SERVER_PUB = "serverPub"
        const val EXTRA_SERVER_IP = "serverIp"
        const val EXTRA_SERVER_ASSIGNED = "serverAssigned"
        const val EXTRA_PORT = "port"
        const val EXTRA_OBFS = "obfs"
        const val EXTRA_DNS = "dns"

        // wg-tls: the gateway TLS relay (host:port) to bridge to, and the SNI to
        // present. Both present → the WG device is bridged over TLS.
        const val EXTRA_TLS_RELAY = "tlsRelay"
        const val EXTRA_TLS_SNI = "tlsSni"

        @Volatile
        private var activeHandle: Long = 0

        /** Live counters for the running obfs tunnel (CSV from the Go core). */
        fun statistics(): CumulusTunnelController.Stats {
            val h = activeHandle
            if (h == 0L) {
                return CumulusTunnelController.Stats(0, 0, 0)
            }
            return try {
                val parts = Wgmobile.getStats(h).split(",")
                CumulusTunnelController.Stats(
                    parts.getOrNull(0)?.toLongOrNull() ?: 0,
                    parts.getOrNull(1)?.toLongOrNull() ?: 0,
                    parts.getOrNull(2)?.toLongOrNull() ?: 0,
                )
            } catch (t: Throwable) {
                CumulusTunnelController.Stats(0, 0, 0)
            }
        }

        private fun Intent.req(key: String): String =
            getStringExtra(key) ?: throw IllegalArgumentException("missing extra: $key")
    }
}
