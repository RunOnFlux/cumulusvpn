package com.cumulusvpn.tunnel

import android.content.Context
import android.content.Intent
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

    /** True while the active tunnel is the nested (multi-hop) service, not GoBackend. */
    @Volatile
    private var multihopActive: Boolean = false

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
     * Genuine nesting runs in the userspace `wgnest` core (two stacked
     * wireguard-go devices, the inner's socket a UDP conn on the outer's
     * netstack), bound to Android via the [Wgmobile] AAR. This controller only
     * extracts the two hops' keys/IPs from the parsed configs and hands them to
     * [CumulusMultihopVpnService], which owns the OS tun. The service reports
     * back through [onMultihopState].
     */
    fun startMultihop(context: Context, outerConfig: String, innerConfig: String) {
        setState(STATE_CONNECTING)
        try {
            val outer = parse(outerConfig) // wg-entry: AllowedIPs = <exitIp>/32, MTU 1420
            val inner = parse(innerConfig) // wg-exit:  AllowedIPs = 0.0.0.0/0, MTU 1340

            val entryPeer = outer.peers.first()
            val exitPeer = inner.peers.first()
            // The client key K is shared by both hops (one payment, two devices).
            val clientPriv = outer.`interface`.keyPair.privateKey.toBase64()
            val entryAssigned = outer.`interface`.addresses.first().address.hostAddress
            val exitAssigned = inner.`interface`.addresses.first().address.hostAddress
            val entryIp = entryPeer.endpoint.get().host
            val exitIp = exitPeer.endpoint.get().host
            val exitDns = inner.`interface`.dnsServers.firstOrNull()?.hostAddress ?: "1.1.1.1"

            Log.i(TAG, "startMultihop: entry=$entryIp exit=$exitIp (nested)")

            val intent = Intent(context, CumulusMultihopVpnService::class.java).apply {
                action = CumulusMultihopVpnService.ACTION_START
                putExtra(CumulusMultihopVpnService.EXTRA_CLIENT_PRIV, clientPriv)
                putExtra(CumulusMultihopVpnService.EXTRA_ENTRY_PUB, entryPeer.publicKey.toBase64())
                putExtra(CumulusMultihopVpnService.EXTRA_ENTRY_IP, entryIp)
                putExtra(CumulusMultihopVpnService.EXTRA_ENTRY_ASSIGNED, entryAssigned)
                putExtra(CumulusMultihopVpnService.EXTRA_EXIT_PUB, exitPeer.publicKey.toBase64())
                putExtra(CumulusMultihopVpnService.EXTRA_EXIT_IP, exitIp)
                putExtra(CumulusMultihopVpnService.EXTRA_EXIT_ASSIGNED, exitAssigned)
                putExtra(CumulusMultihopVpnService.EXTRA_EXIT_DNS, exitDns)
            }
            multihopActive = true
            // Connect is always user-initiated (app in foreground), so a plain
            // startService is allowed; the established tun keeps the service alive.
            context.startService(intent)
            // State advances to CONNECTED/ERROR asynchronously via onMultihopState.
        } catch (t: Throwable) {
            Log.e(TAG, "startMultihop failed", t)
            multihopActive = false
            setState(STATE_ERROR)
            throw t
        }
    }

    /** Called by [CumulusMultihopVpnService] as the nested tunnel changes state. */
    fun onMultihopState(state: String) {
        if (state == STATE_DISCONNECTED || state == STATE_ERROR) {
            multihopActive = false
        }
        setState(state)
    }

    /** Tear the tunnel down. Idempotent. Routes to whichever backend is active. */
    fun stopTunnel(context: Context) {
        setState(STATE_DISCONNECTING)
        try {
            if (multihopActive) {
                val intent = Intent(context, CumulusMultihopVpnService::class.java).apply {
                    action = CumulusMultihopVpnService.ACTION_STOP
                }
                context.startService(intent)
                // onMultihopState(DISCONNECTED) fires from the service's teardown.
            } else {
                backend?.setState(tunnel, Tunnel.State.DOWN, null)
                setState(STATE_DISCONNECTED)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "stopTunnel failed", t)
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
