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
        handle = Wgmobile.startSingle(
            clientPriv, serverPub, serverIp, serverAssigned,
            fd.toLong(), port.toLong(), obfs,
        )
        activeHandle = handle
        Log.i(TAG, "obfs single-hop up: server=$serverIp:$port handle=$handle")
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
            tun?.close()
        } catch (_: Throwable) {
        }
        tun = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
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
