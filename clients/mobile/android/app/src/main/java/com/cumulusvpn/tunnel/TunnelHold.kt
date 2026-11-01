package com.cumulusvpn.tunnel

import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * The kill switch's HELD state on Android: a VPN interface that captures every
 * route and that nothing reads, so every packet the device sends is dropped.
 *
 * Android only blocks traffic outside a VPN when the user turns on the system
 * "Block connections without VPN" setting, which apps cannot do for them. So
 * our services never take the VPN down to change route or to recover: they
 * replace the interface with this one (or with the next route's), which the
 * platform swaps in without a gap, and only the app's Disconnect closes it.
 *
 * Our own app is left out of it. While held, the app must still reach gateways
 * to enroll on the next node, and its traffic is only control-API requests
 * (the data plane's sockets are `protect()`ed anyway).
 */
object TunnelHold {
    private const val TAG = "CumulusHold"

    fun establishBlocking(service: VpnService): ParcelFileDescriptor {
        val builder = service.Builder()
            .setSession("CumulusVPN")
            .addAddress(HOLD_V4, 32)
            .addRoute("0.0.0.0", 0)
            .setMtu(1280)
            .setBlocking(true)
        try {
            builder.addAddress(HOLD_V6, 128)
            builder.addRoute("::", 0)
        } catch (t: Throwable) {
            Log.w(TAG, "could not capture IPv6 while held", t)
        }
        builder.addDisallowedApplication(service.packageName)
        return builder.establish()
            ?: throw IllegalStateException("VPN establish() returned null — consent revoked?")
    }

    // Placeholder addresses for the interface; nothing is ever routed back.
    private const val HOLD_V4 = "10.255.255.254"
    private const val HOLD_V6 = "fd00:6375:6d75::1"
}
