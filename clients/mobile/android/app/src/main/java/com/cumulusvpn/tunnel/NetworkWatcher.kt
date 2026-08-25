package com.cumulusvpn.tunnel

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Watches the device's DEFAULT network and reports a genuine change (Wi-Fi to
 * cellular, one Wi-Fi to another, cellular back to Wi-Fi).
 *
 * ## Why a VPN needs this
 *
 * WireGuard roams by design, but only the SERVER half is automatic: a gateway
 * relearns a peer's endpoint from any authenticated packet, so a session
 * resumes the instant one datagram arrives from the new address. The client
 * half is not automatic. Its UDP socket stays bound to the interface that just
 * went away, so nothing is ever sent, nothing arrives, and the gateway never
 * learns anything. Android keeps reporting the VPN as connected the whole time,
 * because the tun device is still up — which is exactly why the app's existing
 * auto-reconnect never fires: it triggers on `disconnected`, and the OS never
 * says that. The user watches a "connected" VPN carry no traffic.
 *
 * So the fix has to start here, with the only signal that a roam happened.
 *
 * ## Why the callbacks are debounced
 *
 * One roam is not one callback. Losing Wi-Fi and gaining cellular produces
 * `onLost` + `onAvailable` + usually `onCapabilitiesChanged`, within
 * milliseconds. Acting on each would rebind three times, and on the wg-tls
 * transport (where a change means a full reconnect) it would start three
 * reconnects. [DEBOUNCE_MS] collapses a burst into the one event it really was.
 *
 * ## Why the first callback is swallowed
 *
 * `registerDefaultNetworkCallback` fires immediately for the network already in
 * use. That is not a change, and reacting to it would rebind every tunnel a
 * moment after it came up — harmless, but it would make the logs lie about how
 * often roams happen.
 */
class NetworkWatcher(
    private val context: Context,
    private val onChanged: (Network?) -> Unit,
) {
    private val cm: ConnectivityManager? =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    private val main = Handler(Looper.getMainLooper())

    /** The network we last reported on; null before the first callback. */
    private var current: Network? = null

    /** Set once the first (current-network) callback has been absorbed. */
    private var primed = false

    private var pending: Runnable? = null

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = schedule(network)

        override fun onLost(network: Network) {
            // Only interesting if the network we are actually using went away.
            // A background network dropping is not our problem, and reacting to
            // it would rebind onto an interface that never changed.
            if (network == current) schedule(null)
        }
    }

    fun start() {
        val manager = cm ?: run {
            Log.w(TAG, "no ConnectivityManager — roaming will not be detected")
            return
        }
        try {
            manager.registerDefaultNetworkCallback(callback)
        } catch (t: Throwable) {
            // Never fatal: losing roam detection degrades to the pre-existing
            // behaviour (a dead tunnel until the user toggles), whereas a throw
            // here would take the whole tunnel down.
            Log.e(TAG, "registerDefaultNetworkCallback failed", t)
        }
    }

    fun stop() {
        pending?.let { main.removeCallbacks(it) }
        pending = null
        try {
            cm?.unregisterNetworkCallback(callback)
        } catch (_: Throwable) {
            // Already unregistered, or never registered.
        }
    }

    private fun schedule(network: Network?) {
        if (!primed) {
            primed = true
            current = network
            return
        }
        if (network == current) {
            return
        }
        current = network
        pending?.let { main.removeCallbacks(it) }
        val r = Runnable {
            pending = null
            Log.i(TAG, "default network changed -> $network")
            try {
                onChanged(network)
            } catch (t: Throwable) {
                Log.e(TAG, "network-change handler failed", t)
            }
        }
        pending = r
        main.postDelayed(r, DEBOUNCE_MS)
    }

    private companion object {
        const val TAG = "CumulusNetWatch"

        /** Long enough to absorb a lost/gained burst, short enough to be invisible. */
        const val DEBOUNCE_MS = 400L
    }
}
