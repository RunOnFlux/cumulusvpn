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
        // Capture ALL IPv6 into the tun as well. The tun has no IPv6 address, so
        // v6 packets have nowhere to go and are dropped — but critically they do
        // NOT bypass the VPN over the underlying network (the classic IPv6 leak
        // for a privacy VPN). Single-hop gets this for free from wireguard-android
        // applying the config's `::/0`; the nested builder must add it explicitly.
        try {
            builder.addRoute("::", 0)
        } catch (t: Throwable) {
            Log.w(TAG, "could not add IPv6 blackhole route", t)
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
            // entryPort 0 => default 51820; obfs "" => vanilla entry. Android
            // obfuscation (threading the awg params + port through the Intent
            // extras) is a later step; multi-hop stays vanilla for now.
            0L,
            "",
        )
        activeHandle = handle
        Log.i(TAG, "nested tunnel up: entry=$entryIp exit=$exitIp handle=$handle")
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
        // The Go tun owns the fd via detachFd; if establish() failed before that,
        // close whatever pfd we still hold.
        try {
            tun?.close()
        } catch (_: Throwable) {
        }
        tun = null
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
        val notif = NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setContentTitle("CumulusVPN")
            .setContentText("Multi-hop tunnel active")
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
