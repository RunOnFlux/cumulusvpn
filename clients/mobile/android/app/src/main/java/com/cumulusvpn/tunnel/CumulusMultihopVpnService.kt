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

    // Set by ACTION_STOP; checked right after Wgmobile.start so a stop that lands
    // while connect() is still running on the worker thread doesn't leave an
    // orphaned tunnel (teardown() would see handle==0 and no-op, then start
    // completes with the service already stopped).
    @Volatile
    private var stopRequested = false

    /** Route text for the ongoing notification; blank = generic copy. */
    private var notifText: String = ""

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopRequested = true
                // Stopping the nested Go pair is a JNI call that can block for
                // a second or more — never on the main thread, or the whole UI
                // (including the app's disconnect animation) freezes with it.
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
                // Run as a foreground service so the OS won't kill the process (and
                // silently drop the tunnel) under memory pressure / doze. Must be
                // called promptly after start; the notification also makes the
                // active VPN visible, as platform policy expects.
                startForegroundNotification()
                // Bring the nested tunnel up OFF the main thread: it wraps the tun
                // fd and starts two wireguard-go devices via JNI, which must not
                // block the main looper (ANR / process freeze).
                Thread {
                    try {
                        // Same reconnect guard as the single-hop service:
                        // another START lands on this live instance, and
                        // stacking a second nested pair on top of the first
                        // leaves neither able to handshake. JNI when live —
                        // hence inside this thread; stopDataPlane (not
                        // teardown) keeps the notification just posted.
                        if (handle != 0L || tun != null) {
                            Log.i(TAG, "replacing a live session before reconnect")
                            stopDataPlane()
                        }
                        connect(startIntent)
                        if (stopRequested) {
                            // A stop raced in during connect — tear the just-started
                            // tunnel down cleanly instead of leaving it orphaned.
                            teardown()
                            CumulusTunnelController.onMultihopState(CumulusTunnelController.STATE_DISCONNECTED)
                            stopSelf()
                        } else {
                            CumulusTunnelController.onMultihopState(CumulusTunnelController.STATE_CONNECTED)
                        }
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
        // Stealth obfuscates the ENTRY hop with AmneziaWG: its awg port (51821) +
        // the [Interface] obfs UAPI. 0 / "" => vanilla entry (Auto mode).
        val entryPort = intent.getIntExtra(EXTRA_ENTRY_PORT, 0)
        val entryObfs = intent.getStringExtra(EXTRA_ENTRY_OBFS) ?: ""

        // Split tunneling (docs/17): the compiled v4 tunnel-route list from the
        // inner config's AllowedIPs, or null for the classic full tunnel.
        val routes4 = intent.getStringExtra(EXTRA_ROUTES4)

        // Inner tun: the exit-assigned address, exit DNS, room for two WG headers.
        val builder = Builder()
            .setSession("CumulusVPN")
            .addAddress(exitAssigned, 32)
            .addDnsServer(exitDns)
            .setMtu(1340)
            .setBlocking(true)
        // Per-app rules (docs/17 §4.1) — kernel-enforced by the tun scoping.
        applyAppRules(
            builder,
            intent.getStringExtra(EXTRA_APPS_INCLUDED),
            intent.getStringExtra(EXTRA_APPS_EXCLUDED),
        )
        // Route the tunnel-route set (everything, or the split policy's routes)
        // EXCEPT the entry gateway IP into the tun, so the outer device's real
        // socket to the entry bypasses the VPN (no loop).
        val tunRoutes =
            if (routes4.isNullOrBlank()) {
                routesExcluding(entryIp)
            } else {
                subtractHost(parseRoutesCsv(routes4), entryIp)
            }
        for ((net, prefix) in tunRoutes) {
            builder.addRoute(net, prefix)
        }
        // Capture ALL IPv6 into the tun as well. The tun has no IPv6 address, so
        // v6 packets have nowhere to go and are dropped — but critically they do
        // NOT bypass the VPN over the underlying network (the classic IPv6 leak
        // for a privacy VPN). Single-hop gets this for free from wireguard-android
        // applying the config's `::/0`; the nested builder must add it explicitly.
        // With a split policy the compiled v6 tunnel routes replace the blackhole,
        // so an excluded v6 prefix really does bypass instead of being dropped.
        val routes6 = intent.getStringExtra(EXTRA_ROUTES6)
        try {
            if (routes6.isNullOrBlank()) {
                builder.addRoute("::", 0)
            } else {
                for ((net, prefix) in parseRoutes6Csv(routes6)) {
                    builder.addRoute(net, prefix)
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "could not add IPv6 route(s)", t)
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
            // entryPort 0 => default 51820, obfs "" => vanilla entry (Auto); for
            // Stealth these carry the entry's awg port + [Interface] obfs UAPI, so
            // the entry hop is obfuscated (the exit hop stays vanilla).
            entryPort.toLong(),
            entryObfs,
        )
        activeHandle = handle
        Log.i(TAG, "nested tunnel up: entry=$entryIp:$entryPort exit=$exitIp obfs=${entryObfs.isNotEmpty()} handle=$handle")
    }

    /**
     * Stop the nested Go pair / tun — the JNI half of teardown, which can
     * block; only ever call it off the main thread. Synchronized so a threaded
     * stop can't interleave with a replace-before-reconnect.
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
        // The Go tun owns the fd via detachFd; if establish() failed before that,
        // close whatever pfd we still hold.
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

    /** Promote to a foreground service with an ongoing "VPN active" notification. */
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
            .setContentText(notifText.ifBlank { "Multi-hop tunnel active" })
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            // API 31+ defers FGS notifications ~10s by default — see the same
            // annotation in CumulusObfsVpnService: the first connect of a
            // session would show no notification without this.
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
        CumulusTunnelController.onMultihopState(CumulusTunnelController.STATE_DISCONNECTED)
        super.onDestroy()
    }

    override fun onRevoke() {
        // The OS or another VPN app revoked us. Same rule as ACTION_STOP: the
        // JNI teardown must not block the main thread this callback runs on.
        stopRequested = true
        Thread {
            teardown()
            CumulusTunnelController.onMultihopState(CumulusTunnelController.STATE_DISCONNECTED)
            stopSelf()
        }.start()
        super.onRevoke()
    }

    companion object {
        private const val TAG = "CumulusMultihop"
        private const val NOTIF_CHANNEL = "cumulusvpn.vpn"
        private const val NOTIF_ID = 1001

        const val ACTION_START = "com.cumulusvpn.multihop.START"
        const val ACTION_STOP = "com.cumulusvpn.multihop.STOP"

        // Handle of the live nested tunnel, so the controller can read its live
        // counters (the service instance owns the tun; stats are per-handle).
        @Volatile
        private var activeHandle: Long = 0

        /**
         * Live counters for the running nested tunnel. The Go core returns them
         * as the CSV "rx,tx,lastHandshakeSec" (from the inner device, which
         * carries all real traffic); zeros mean "no tunnel / no data yet".
         */
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

        const val EXTRA_CLIENT_PRIV = "clientPriv"
        const val EXTRA_ENTRY_PUB = "entryPub"
        const val EXTRA_ENTRY_IP = "entryIp"
        const val EXTRA_ENTRY_ASSIGNED = "entryAssigned"
        const val EXTRA_EXIT_PUB = "exitPub"
        const val EXTRA_EXIT_IP = "exitIp"
        const val EXTRA_EXIT_ASSIGNED = "exitAssigned"
        const val EXTRA_EXIT_DNS = "exitDns"
        const val EXTRA_NOTIF_TEXT = "notifText"

        // Stealth: the ENTRY hop's awg port (51821) + [Interface] obfs UAPI. Absent
        // / 0 / "" => vanilla entry.
        const val EXTRA_ENTRY_PORT = "entryPort"
        const val EXTRA_ENTRY_OBFS = "entryObfs"

        // Split tunneling (docs/17): compiled tunnel-route CSVs from the inner
        // config's AllowedIPs. Absent/blank => classic full tunnel.
        const val EXTRA_ROUTES4 = "routes4"
        const val EXTRA_ROUTES6 = "routes6"

        // Per-app rules (docs/17 §4.1): comma-separated package names. The two
        // are mutually exclusive on Android (the builder throws if both are
        // used); the core compiler guarantees at most one is non-empty.
        const val EXTRA_APPS_INCLUDED = "appsIncluded"
        const val EXTRA_APPS_EXCLUDED = "appsExcluded"

        /**
         * Apply per-app rules to a [android.net.VpnService.Builder].
         * `addDisallowedApplication` throws for an uninstalled package — catch
         * per package and skip it, so a stale rule can never fail the connect
         * (the JS picker prunes stale rules when it next lists apps). An
         * *included* app that is missing is also skipped: with include-direction
         * rules the tun only carries the listed apps, so a missing one simply
         * contributes nothing.
         */
        fun applyAppRules(
            builder: android.net.VpnService.Builder,
            includedCsv: String?,
            excludedCsv: String?,
        ) {
            for (pkg in splitPkgs(includedCsv)) {
                try {
                    builder.addAllowedApplication(pkg)
                } catch (t: Throwable) {
                    Log.w(TAG, "skipping missing included app: $pkg")
                }
            }
            for (pkg in splitPkgs(excludedCsv)) {
                try {
                    builder.addDisallowedApplication(pkg)
                } catch (t: Throwable) {
                    Log.w(TAG, "skipping missing excluded app: $pkg")
                }
            }
        }

        private fun splitPkgs(csv: String?): List<String> =
            csv?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()

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

        /** Parse a comma-separated IPv4 CIDR list ("1.2.3.0/24, 5.0.0.0/8"),
         *  skipping v6 entries and anything malformed (fail toward fewer tun
         *  routes = more traffic direct is WRONG here — so malformed input in a
         *  list that came from our own compiler is dropped loudly via log). */
        /** Strict dotted-quad check — the net part later reaches
         *  `InetAddress.getByName`, where a non-literal would trigger a DNS
         *  lookup, and `Builder.addRoute`, where it would throw. */
        private fun isIpv4(s: String): Boolean {
            val octets = s.split('.')
            return octets.size == 4 && octets.all { o ->
                o.isNotEmpty() && o.length <= 3 && o.all { it.isDigit() } && o.toInt() <= 255
            }
        }

        fun parseRoutesCsv(csv: String): List<Pair<String, Int>> {
            val out = ArrayList<Pair<String, Int>>()
            for (raw in csv.split(',')) {
                val item = raw.trim()
                if (item.isEmpty() || item.contains(':')) continue
                val net = item.substringBefore('/')
                val prefix = item.substringAfter('/', "32").toIntOrNull()
                if (!isIpv4(net) || prefix == null || prefix < 0 || prefix > 32) {
                    Log.w(TAG, "dropping malformed route: $item")
                    continue
                }
                out.add(net to prefix)
            }
            return out
        }

        /** Parse a comma-separated IPv6 CIDR list, skipping v4 entries. */
        fun parseRoutes6Csv(csv: String): List<Pair<String, Int>> {
            val out = ArrayList<Pair<String, Int>>()
            for (raw in csv.split(',')) {
                val item = raw.trim()
                if (item.isEmpty() || !item.contains(':')) continue
                val net = item.substringBefore('/')
                val prefix = item.substringAfter('/', "128").toIntOrNull()
                if (prefix == null || prefix < 0 || prefix > 128) {
                    Log.w(TAG, "dropping malformed route: $item")
                    continue
                }
                out.add(net to prefix)
            }
            return out
        }

        /**
         * `routes` minus `excludeIp/32`, as a minimal exact set — the shared
         * complement algorithm (docs/17 §5) anchored inside an arbitrary route
         * list instead of `0.0.0.0/0`. Routes not containing the IP pass through
         * unchanged; the one containing it is replaced by its sibling chain from
         * `prefix+1` down to `/32` (the [routesExcluding] construction, bounded
         * to that prefix). Applying this to the full default reproduces
         * [routesExcluding] exactly.
         */
        fun subtractHost(
            routes: List<Pair<String, Int>>,
            excludeIp: String,
        ): List<Pair<String, Int>> {
            val bytes = InetAddress.getByName(excludeIp).address
            val ip = ((bytes[0].toLong() and 0xff) shl 24) or
                ((bytes[1].toLong() and 0xff) shl 16) or
                ((bytes[2].toLong() and 0xff) shl 8) or
                (bytes[3].toLong() and 0xff)
            val out = ArrayList<Pair<String, Int>>(routes.size + 32)
            for ((net, prefix) in routes) {
                val netLong = ipToLong(net)
                val hostBits = 32 - prefix
                val mask = if (hostBits >= 32) 0L else (0xFFFFFFFFL shl hostBits) and 0xFFFFFFFFL
                if ((ip and mask) != (netLong and mask)) {
                    out.add(net to prefix) // does not contain the IP — unchanged
                    continue
                }
                for (p in (prefix + 1)..32) {
                    val hb = 32 - p
                    val bit = 1L shl hb
                    val m = (0xFFFFFFFFL shl hb) and 0xFFFFFFFFL
                    out.add(longToIp((ip xor bit) and m) to p)
                }
            }
            return out
        }

        private fun ipToLong(ip: String): Long {
            val bytes = InetAddress.getByName(ip).address
            return ((bytes[0].toLong() and 0xff) shl 24) or
                ((bytes[1].toLong() and 0xff) shl 16) or
                ((bytes[2].toLong() and 0xff) shl 8) or
                (bytes[3].toLong() and 0xff)
        }

        private fun longToIp(v: Long): String =
            "${(v ushr 24) and 0xff}.${(v ushr 16) and 0xff}.${(v ushr 8) and 0xff}.${v and 0xff}"
    }
}
