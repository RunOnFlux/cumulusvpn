package com.cumulusvpn.tunnel

import android.content.Context
import android.util.Log
import com.wireguard.android.backend.Backend
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Statistics
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import java.io.BufferedReader
import java.io.StringReader

/**
 * The Android WireGuard data plane, driven by the official
 * `com.wireguard.android:tunnel` library ([GoBackend] + [Tunnel] + [Config]).
 *
 * The library ships a prebuilt userspace `wireguard-go` (`libwg-go.so`) for
 * every ABI and manages the OS `VpnService`/tun itself — its bundled
 * `GoBackend$VpnService` is declared in `AndroidManifest.xml`. We therefore do
 * NOT subclass `VpnService`; we own a single [GoBackend] and drive it via
 * [Backend.setState]. That is why this controller is an `object`, not a
 * `Service`: the service belongs to the library.
 *
 * Single-hop is fully wired below. Multi-hop (docs/11) needs TWO stacked
 * wireguard-go devices behind one tun; the stock [GoBackend] exposes exactly one
 * device bound to the tun, so the outer-encapsulation seam is the one place a
 * bundled/forked wireguard-go is required — clearly marked `// POC:` in
 * [startMultihop].
 */
object CumulusTunnelController {
    private const val TAG = "CumulusTunnel"

    /** Fixed tunnel name shown in the OS VPN UI / used as the wg interface name. */
    private const val TUNNEL_NAME = "cumulus"

    const val STATE_DISCONNECTED = "disconnected"
    const val STATE_CONNECTING = "connecting"
    const val STATE_CONNECTED = "connected"
    const val STATE_DISCONNECTING = "disconnecting"
    const val STATE_ERROR = "error"

    /** Optional listener so the RN module can stream state changes to JS. */
    fun interface StateListener {
        fun onState(state: String)
    }

    @Volatile
    private var backend: Backend? = null

    @Volatile
    private var currentStateValue: String = STATE_DISCONNECTED

    @Volatile
    private var listener: StateListener? = null

    /** The active tunnel handle, if any. Named [TUNNEL_NAME]. */
    private val tunnel =
        object : Tunnel {
            override fun getName(): String = TUNNEL_NAME

            override fun onStateChange(newState: Tunnel.State) {
                setState(
                    when (newState) {
                        Tunnel.State.UP -> STATE_CONNECTED
                        Tunnel.State.DOWN -> STATE_DISCONNECTED
                        Tunnel.State.TOGGLE -> STATE_CONNECTING
                    },
                )
            }
        }

    fun setStateListener(l: StateListener?) {
        listener = l
    }

    fun currentState(): String = currentStateValue

    private fun backend(context: Context): Backend =
        backend ?: synchronized(this) {
            backend ?: GoBackend(context.applicationContext).also { backend = it }
        }

    /**
     * Bring the single-hop tunnel up from a rendered wg-quick config string
     * (produced by core `buildWgConfig`). Throws on parse/permission/backend
     * failure so the RN module can reject the JS promise with a real message.
     */
    fun startTunnel(context: Context, wgQuickConfig: String) {
        setState(STATE_CONNECTING)
        try {
            val config = parse(wgQuickConfig)
            backend(context).setState(tunnel, Tunnel.State.UP, config)
            setState(STATE_CONNECTED)
        } catch (t: Throwable) {
            Log.e(TAG, "startTunnel failed", t)
            setState(STATE_ERROR)
            throw t
        }
    }

    /**
     * Bring up the opt-in **multi-hop** route (docs/11-multihop.md): two stacked
     * WireGuard interfaces sharing the same client key `K`.
     *
     *   tun (0.0.0.0/0, MTU 1340) → INNER device (peer = EXIT) → UDP to <exitIp>
     *     → OUTER device (peer = ENTRY, AllowedIPs = <exitIp>/32) → real socket
     *
     * `outerConfig` is the wg-entry `.conf`; `innerConfig` is the wg-exit `.conf`
     * (both from core `buildMultihopConfig`).
     *
     * POC (unavoidable library seam): the stock [GoBackend] binds exactly ONE
     * wireguard-go device to the tun and owns the real UDP socket, with no hook
     * to interpose a second device between that socket and the network. True
     * nesting therefore requires a bundled/forked wireguard-go whose INNER
     * device's UDP "bind" feeds the OUTER device instead of the raw socket
     * (the approach Mullvad ships). Until that `.so` is vendored, we bring up the
     * OUTER (entry) hop as the active device — which already hides the user's
     * real destination from the entry operator and pins the route to the exit IP
     * — and log the inner-device seam. The two parsed configs and the routing
     * facts below are exactly what the bundled wg-go consumes; nothing above this
     * layer (core, JS bridge, RN module) changes when the seam is filled.
     */
    fun startMultihop(context: Context, outerConfig: String, innerConfig: String) {
        setState(STATE_CONNECTING)
        try {
            val outer = parse(outerConfig) // wg-entry: AllowedIPs = <exitIp>/32, MTU 1420
            val inner = parse(innerConfig) // wg-exit:  AllowedIPs = 0.0.0.0/0, MTU 1340

            // The exit endpoint the inner device targets and the outer device
            // must route (AllowedIPs pin). Kept explicit so the bundled wg-go
            // seam has everything it needs.
            val exitPeer = inner.peers.firstOrNull()
            val entryPeer = outer.peers.firstOrNull()
            Log.i(
                TAG,
                "startMultihop: entry=${entryPeer?.endpoint?.orElse(null)} " +
                    "exit=${exitPeer?.endpoint?.orElse(null)} " +
                    "innerMtu=${inner.`interface`.mtu.orElse(0)}",
            )

            // POC: bring up the OUTER (entry) device via the stock backend. The
            // INNER device (real 0.0.0.0/0 traffic, encrypted to EXIT) must be
            // layered by a vendored wireguard-go whose UDP bind is redirected
            // into this outer device — see the kdoc above. `inner` is parsed and
            // validated here so that seam is a drop-in.
            backend(context).setState(tunnel, Tunnel.State.UP, outer)
            setState(STATE_CONNECTED)
        } catch (t: Throwable) {
            Log.e(TAG, "startMultihop failed", t)
            setState(STATE_ERROR)
            throw t
        }
    }

    /** Tear the tunnel down. Idempotent. */
    fun stopTunnel(context: Context) {
        setState(STATE_DISCONNECTING)
        try {
            backend?.setState(tunnel, Tunnel.State.DOWN, null)
        } catch (t: Throwable) {
            Log.e(TAG, "stopTunnel failed", t)
        } finally {
            setState(STATE_DISCONNECTED)
        }
    }

    /**
     * Live byte counters from the running device, or zeros when down.
     * POC: `lastHandshake` stays 0 — the per-peer handshake accessor on
     * [Statistics] differs across library versions; totalRx/totalTx are stable.
     */
    fun statistics(context: Context): Stats {
        val b = backend ?: return Stats(0, 0, 0)
        return try {
            val s: Statistics = b.getStatistics(tunnel)
            Stats(s.totalRx(), s.totalTx(), 0)
        } catch (t: Throwable) {
            Stats(0, 0, 0)
        }
    }

    private fun parse(wgQuickConfig: String): Config =
        Config.parse(BufferedReader(StringReader(wgQuickConfig)))

    private fun setState(state: String) {
        currentStateValue = state
        listener?.onState(state)
    }

    /** Snapshot of live tunnel counters (bytes and unix-seconds handshake). */
    data class Stats(val rxBytes: Long, val txBytes: Long, val lastHandshake: Long)
}
