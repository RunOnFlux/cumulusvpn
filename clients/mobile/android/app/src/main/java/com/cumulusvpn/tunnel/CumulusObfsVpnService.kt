package com.cumulusvpn.tunnel

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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

    /** Route text for the ongoing notification; blank = generic copy. */
    private var notifText: String = ""

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopRequested = true
                // Stopping the Go device is a JNI call that can block for a
                // beat — never on the main thread, or the whole UI (including
                // the app's disconnect animation) freezes with it.
                // stopSelf(startId) is a no-op if a newer START already
                // arrived, so a quick stop→start can't kill the fresh session.
                Thread {
                    teardown()
                    stopSelf(startId)
                }.start()
                return START_NOT_STICKY
            }
            else -> {
                val startIntent = intent ?: return START_NOT_STICKY
                stopRequested = false
                notifText = startIntent.getStringExtra(EXTRA_NOTIF_TEXT) ?: ""
                startForegroundNotification()
                // Bring the tunnel up OFF the main thread (JNI + device start must
                // not block the looper).
                Thread {
                    try {
                        // A reconnect (or a transport-chain fallback) arrives as
                        // another START on the SAME live service instance —
                        // Android does not recreate a started service. Without
                        // this, connect() would start a second Go device while
                        // the first still owns a tun fd and its sockets: the new
                        // tunnel never completes a handshake, so the app sits on
                        // "connecting" and gives up. Idempotent when idle, JNI
                        // when live — hence inside this thread; stopDataPlane
                        // (not teardown) keeps the notification just posted.
                        if (handle != 0L || tun != null || tlsBridge != null) {
                            Log.i(TAG, "replacing a live session before reconnect")
                            stopDataPlane()
                        }
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

        // Split tunneling (docs/17): compiled tunnel-route CSVs from the config's
        // AllowedIPs; absent => classic full tunnel.
        val routes4 = intent.getStringExtra(EXTRA_ROUTES4)
        val routes6 = intent.getStringExtra(EXTRA_ROUTES6)

        val builder = Builder()
            .setSession("CumulusVPN")
            .addAddress(serverAssigned, 32)
            .addDnsServer(dns)
            .setMtu(1420)
            .setBlocking(true)
        // Per-app rules (docs/17 §4.1) — kernel-enforced by the tun scoping.
        CumulusMultihopVpnService.applyAppRules(
            builder,
            intent.getStringExtra(EXTRA_APPS_INCLUDED),
            intent.getStringExtra(EXTRA_APPS_EXCLUDED),
        )
        // Route the tunnel-route set (everything, or the split policy's routes)
        // EXCEPT the gateway IP into the tun, so the device's one real socket to
        // the gateway bypasses the VPN (no loop). Reuses the multi-hop service's
        // route arithmetic.
        val tunRoutes =
            if (routes4.isNullOrBlank()) {
                CumulusMultihopVpnService.routesExcluding(serverIp)
            } else {
                CumulusMultihopVpnService.subtractHost(
                    CumulusMultihopVpnService.parseRoutesCsv(routes4),
                    serverIp,
                )
            }
        for ((net, prefix) in tunRoutes) {
            builder.addRoute(net, prefix)
        }
        // Blackhole IPv6 into the tun so v6 can't leak past the VPN — unless a
        // split policy supplies explicit v6 tunnel routes, in which case excluded
        // v6 prefixes really do bypass instead of being dropped.
        try {
            if (routes6.isNullOrBlank()) {
                builder.addRoute("::", 0)
            } else {
                for ((net, prefix) in CumulusMultihopVpnService.parseRoutes6Csv(routes6)) {
                    builder.addRoute(net, prefix)
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "could not add IPv6 route(s)", t)
        }

        val pfd = builder.establish()
            ?: throw IllegalStateException("VPN establish() returned null — consent revoked?")
        tun = pfd

        // detachFd() moves ownership of the tun OUT of the ParcelFileDescriptor:
        // from here on teardown()'s `tun?.close()` is a no-op, and only the Go
        // core (once startSingle succeeds) or an explicit adoptFd().close() can
        // release it. Anything that throws in between would strand a live
        // full-tunnel interface with no data plane — every packet on the device
        // black-holed, and the service kept alive by the OS because the tun still
        // exists, so there is no in-app way back. Hence the ownership flag.
        val fd = pfd.detachFd()
        var fdOwnedByGo = false
        try {
            // For wg-tls, stand up the UDP<->TLS bridge to the gateway relay (its
            // TCP socket bypasses the tun via the gateway-IP route exclusion
            // above) and point the WG device at 127.0.0.1:<bridgePort> with NO
            // obfs (the TLS wrapper is the obfuscation). Otherwise the WG device
            // dials the gateway directly (vanilla awg over UDP).
            var wgServerIp = serverIp
            var wgPort = port
            var wgObfs = obfs
            if (tlsSni != null && tlsRelay != null) {
                val (relayHost, relayPort) = splitHostPort(tlsRelay)
                val bridge = WgTlsBridge()
                tlsBridge = bridge
                // Can throw: TCP connect timeout, TLS handshake failure, or the
                // socket being closed by a concurrent teardown.
                val localPort = bridge.start(relayHost, relayPort, tlsSni)
                wgServerIp = "127.0.0.1"
                wgPort = localPort
                wgObfs = ""
            }

            handle = Wgmobile.startSingle(
                clientPriv, serverPub, wgServerIp, serverAssigned,
                fd.toLong(), wgPort.toLong(), wgObfs,
            )
            // Go owns the fd now and closes it on Wgmobile.stop.
            fdOwnedByGo = true
            activeHandle = handle
            Log.i(TAG, "wgnest single-hop up: server=$wgServerIp:$wgPort tls=${tlsSni != null} handle=$handle")
        } finally {
            if (!fdOwnedByGo) {
                try {
                    ParcelFileDescriptor.adoptFd(fd).close()
                } catch (t: Throwable) {
                    Log.e(TAG, "could not close orphaned tun fd", t)
                }
            }
        }
    }

    /**
     * Stop the Go device / TLS bridge / tun — the JNI half of teardown, which
     * can block; only ever call it off the main thread. Synchronized so a
     * threaded stop can't interleave with a replace-before-reconnect.
     */
    @Synchronized
    private fun stopDataPlane() {
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
    }

    private fun teardown() {
        stopDataPlane()
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
        // Tap → bring the app to the foreground.
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val tap = launch?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        val notif = NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setContentTitle("CumulusVPN")
            .setContentText(notifText.ifBlank { "VPN tunnel active" })
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            // API 31+ defers FGS notifications ~10s by default — on the first
            // connect of a session the shade shows nothing (a reconnect shows
            // instantly only because a recently-visible FGS notification skips
            // deferral). A VPN status notification must be immediate.
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .apply { if (tap != null) setContentIntent(tap) }
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
        // Same rule as ACTION_STOP: the JNI teardown must not block the main
        // thread the OS delivers this callback on.
        stopRequested = true
        Thread {
            teardown()
            CumulusTunnelController.onObfsState(CumulusTunnelController.STATE_DISCONNECTED)
            stopSelf()
        }.start()
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
        const val EXTRA_NOTIF_TEXT = "notifText"

        // wg-tls: the gateway TLS relay (host:port) to bridge to, and the SNI to
        // present. Both present → the WG device is bridged over TLS.
        const val EXTRA_TLS_RELAY = "tlsRelay"
        const val EXTRA_TLS_SNI = "tlsSni"

        // Split tunneling (docs/17): compiled tunnel-route CSVs from the config's
        // AllowedIPs. Absent/blank => classic full tunnel.
        const val EXTRA_ROUTES4 = "routes4"
        const val EXTRA_ROUTES6 = "routes6"

        // Per-app rules (docs/17 §4.1): comma-separated package names.
        const val EXTRA_APPS_INCLUDED = "appsIncluded"
        const val EXTRA_APPS_EXCLUDED = "appsExcluded"

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
