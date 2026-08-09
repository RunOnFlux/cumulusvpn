package com.cumulusvpn.tunnel

import android.content.Context
import android.content.Intent
import android.util.Log
import com.wireguard.config.Config
import java.io.BufferedReader
import java.io.StringReader

/**
 * The Android WireGuard data plane. Every transport — vanilla, AmneziaWG
 * (`awg`), `wg-tls` and multi-hop — runs on the ONE userspace `wgnest` Go core
 * (`libgojni.so`, via the [Wgmobile] AAR) inside our own `VpnService`s:
 * [CumulusObfsVpnService] for single-hop, [CumulusMultihopVpnService] for the
 * nested pair. This controller only parses configs and routes intents; it owns
 * no data plane itself, which is why it is an `object` and not a `Service`.
 *
 * **One Go runtime per process — do not add a second.** Vanilla single-hop used
 * to run on the stock `com.wireguard.android:tunnel` `GoBackend`, which bundles
 * its own Go runtime in `libwg-go.so`. With both engines linked, whichever one
 * started SECOND in the process died with `SIGSEGV` (null deref) and took the
 * app with it — reproducible by connecting vanilla, disconnecting, enabling
 * Stealth and connecting again, or the reverse. iOS hit the identical wall and
 * refuses to link WireGuardKit's `libwg-go` (see `PacketTunnelProvider.swift`
 * and docs/13); Android now matches. The wireguard-android dependency is kept
 * ONLY for its pure-Kotlin [Config] parser, which loads no native code — never
 * construct `GoBackend` from it.
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
    private var currentStateValue: String = STATE_DISCONNECTED

    @Volatile
    private var listener: StateListener? = null

    /** True while the active tunnel is the nested (multi-hop) service. */
    @Volatile
    private var multihopActive: Boolean = false

    /** True while the active tunnel is the obfuscated single-hop wgnest service. */
    @Volatile
    private var obfsActive: Boolean = false

    fun setStateListener(l: StateListener?) {
        listener = l
    }

    fun currentState(): String = currentStateValue

    /**
     * Bring the single-hop tunnel up from a rendered wg-quick config string
     * (produced by core `buildWgConfig`). Throws on parse/permission/backend
     * failure so the RN module can reject the JS promise with a real message.
     */
    fun startTunnel(context: Context, wgQuickConfig: String, notifText: String = "") {
        setState(STATE_CONNECTING)
        try {
            // EVERY single-hop transport runs on the ONE wgnest Go core, vanilla
            // included (empty obfs + no TLS SNI == plain WireGuard).
            //
            // Vanilla used to run on the stock wireguard-android [GoBackend],
            // which ships its OWN Go runtime in libwg-go.so. Loading a second Go
            // runtime beside wgnest's libgojni.so in one process is not
            // supported: whichever engine starts SECOND dereferences null and
            // takes the process down with SIGSEGV. It is reproducible in either
            // order — connect vanilla, disconnect, enable Stealth, connect (or
            // the reverse) — because the first engine to run wins the process.
            // iOS already avoids this by refusing to link WireGuardKit's
            // libwg-go (see PacketTunnelProvider.swift / docs/13); Android now
            // matches it. GoBackend is never instantiated, so libwg-go.so is
            // never loaded — the wireguard-android dependency is kept ONLY for
            // its pure-Kotlin `Config` parser, which touches no native code.
            val tlsSni = extractTlsSni(wgQuickConfig)
            val obfs = extractObfsUapi(wgQuickConfig)
            startObfsSingleHop(context, wgQuickConfig, obfs, tlsSni, notifText)
        } catch (t: Throwable) {
            Log.e(TAG, "startTunnel failed", t)
            obfsActive = false
            setState(STATE_ERROR)
            throw t
        }
    }

    /** The AmneziaWG [Interface] keys, capitalized as in the wg-quick `.conf`. */
    private val obfsKeys =
        listOf("Jc", "Jmin", "Jmax", "S1", "S2", "H1", "H2", "H3", "H4")

    /**
     * Scan a `.conf` for AmneziaWG `[Interface]` params and render them as the
     * device-level UAPI lines (`jc=…\n…`), in a fixed order. Empty when the
     * config carries none — i.e. it is a vanilla or wg-tls transport.
     */
    private fun extractObfsUapi(conf: String): String {
        val vals = HashMap<String, String>()
        for (raw in conf.lines()) {
            val line = raw.trim()
            val eq = line.indexOf('=')
            if (eq < 0) continue
            val key = line.substring(0, eq).trim()
            if (key in obfsKeys) {
                vals[key.lowercase()] = line.substring(eq + 1).trim()
            }
        }
        if (vals.isEmpty()) return ""
        return extractObfsUapiOrdered(vals)
    }

    /** Extract the `CVPN_TLS_SNI` sentinel (wg-tls transport), or null. Injected by
     *  the client (useVpn) since the fixed startTunnel bridge can't carry separate
     *  fields; namespaced so it can't collide with a real wg-quick key. */
    private fun extractTlsSni(conf: String): String? {
        for (raw in conf.lines()) {
            val line = raw.trim()
            val eq = line.indexOf('=')
            if (eq < 0) continue
            if (line.substring(0, eq).trim().equals("CVPN_TLS_SNI", ignoreCase = true)) {
                return line.substring(eq + 1).trim()
            }
        }
        return null
    }

    private fun extractObfsUapiOrdered(vals: HashMap<String, String>): String {
        return listOf("jc", "jmin", "jmax", "s1", "s2", "h1", "h2", "h3", "h4")
            .mapNotNull { k -> vals[k]?.let { "$k=$it" } }
            .joinToString("\n", postfix = "\n")
    }

    /** The wgnest fields extracted manually from a wg-quick config. */
    private data class WgFields(
        val priv: String,
        val peerPub: String,
        val endpointHost: String,
        val endpointPort: Int,
        val address: String,
    )

    /**
     * Manually parse the fields wgnest needs from a wg-quick config. Used for a
     * multi-hop OUTER (entry) config, which in Stealth mode carries AmneziaWG
     * `[Interface]` keys the official [Config] parser rejects.
     */
    private fun parseWgFields(conf: String): WgFields {
        var priv = ""
        var pub = ""
        var endpoint = ""
        var address = ""
        for (raw in conf.lines()) {
            val line = raw.trim()
            val eq = line.indexOf('=')
            if (eq < 0) continue
            val key = line.substring(0, eq).trim()
            val value = line.substring(eq + 1).trim()
            when (key) {
                "PrivateKey" -> priv = value
                "PublicKey" -> pub = value
                "Endpoint" -> endpoint = value
                "Address" -> address = value.substringBefore(',').substringBefore('/').trim()
            }
        }
        val host = endpoint.substringBeforeLast(':', endpoint)
        val port = endpoint.substringAfterLast(':', "").toIntOrNull() ?: 0
        return WgFields(priv, pub, host, port, address)
    }

    /**
     * Hand an obfuscated single-hop config to [CumulusObfsVpnService]. We parse
     * the fields manually (the official [Config] parser rejects awg keys) and
     * pass them as Intent extras, mirroring [startMultihop].
     */
    private fun startObfsSingleHop(
        context: Context,
        wgQuickConfig: String,
        obfs: String,
        tlsSni: String?,
        notifText: String,
    ) {
        var priv = ""
        var pub = ""
        var endpoint = ""
        var address = ""
        var dns = "1.1.1.1"
        var allowedIps = ""
        var appsIncluded = ""
        var appsExcluded = ""
        for (raw in wgQuickConfig.lines()) {
            val line = raw.trim()
            val eq = line.indexOf('=')
            if (eq < 0) continue
            val key = line.substring(0, eq).trim()
            val value = line.substring(eq + 1).trim()
            when (key) {
                "PrivateKey" -> priv = value
                "PublicKey" -> pub = value
                "Endpoint" -> endpoint = value
                "Address" -> address = value.substringBefore(',').substringBefore('/').trim()
                "DNS" -> dns = value.substringBefore(',').trim()
                "AllowedIPs" -> allowedIps = value
                "IncludedApplications" -> appsIncluded = value
                "ExcludedApplications" -> appsExcluded = value
            }
        }
        val serverIp = endpoint.substringBeforeLast(':', endpoint)
        val port = endpoint.substringAfterLast(':', "").toIntOrNull() ?: 0
        Log.i(TAG, "startObfsSingleHop: server=$serverIp:$port tls=${tlsSni != null} (stealth)")

        val intent = Intent(context, CumulusObfsVpnService::class.java).apply {
            action = CumulusObfsVpnService.ACTION_START
            putExtra(CumulusObfsVpnService.EXTRA_CLIENT_PRIV, priv)
            putExtra(CumulusObfsVpnService.EXTRA_SERVER_PUB, pub)
            putExtra(CumulusObfsVpnService.EXTRA_SERVER_IP, serverIp)
            putExtra(CumulusObfsVpnService.EXTRA_SERVER_ASSIGNED, address)
            putExtra(CumulusObfsVpnService.EXTRA_PORT, port)
            putExtra(CumulusObfsVpnService.EXTRA_OBFS, obfs)
            putExtra(CumulusObfsVpnService.EXTRA_DNS, dns)
            // Route text for the ongoing notification; blank = generic copy.
            putExtra(CumulusObfsVpnService.EXTRA_NOTIF_TEXT, notifText)
            // wg-tls: bridge the WG device over TLS to the gateway relay (the
            // config Endpoint, gateway:tlsPort). The service excludes the gateway
            // IP from the tun so the TLS socket bypasses it.
            if (tlsSni != null) {
                putExtra(CumulusObfsVpnService.EXTRA_TLS_RELAY, endpoint)
                putExtra(CumulusObfsVpnService.EXTRA_TLS_SNI, tlsSni)
            }
            // Split tunneling: a non-default AllowedIPs (from core's compiled
            // split policy) becomes the tun route set. The default full-tunnel
            // value is deliberately NOT passed, keeping that path byte-identical.
            if (allowedIps.isNotEmpty() && !isFullTunnel(allowedIps)) {
                putExtra(CumulusObfsVpnService.EXTRA_ROUTES4, allowedIps)
                putExtra(CumulusObfsVpnService.EXTRA_ROUTES6, allowedIps)
            }
            // Per-app rules (docs/17 §4.1) — the same keys the vanilla path's
            // official Config parser applies; the wgnest service does it manually.
            if (appsIncluded.isNotEmpty()) {
                putExtra(CumulusObfsVpnService.EXTRA_APPS_INCLUDED, appsIncluded)
            }
            if (appsExcluded.isNotEmpty()) {
                putExtra(CumulusObfsVpnService.EXTRA_APPS_EXCLUDED, appsExcluded)
            }
        }
        obfsActive = true
        multihopActive = false // reciprocal: an obfs→multihop switch must not leave this stale
        context.startService(intent)
        // State advances to CONNECTED/ERROR asynchronously via onObfsState.
    }

    /** Called by [CumulusObfsVpnService] as the obfuscated tunnel changes state. */
    fun onObfsState(state: String) {
        if (state == STATE_DISCONNECTED || state == STATE_ERROR) {
            obfsActive = false
        }
        setState(state)
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
    fun startMultihop(context: Context, outerConfig: String, innerConfig: String, notifText: String = "") {
        setState(STATE_CONNECTING)
        try {
            // The OUTER (entry) config may carry AmneziaWG [Interface] params in
            // Stealth mode, which the official Config parser rejects — so parse its
            // fields manually. The INNER (exit) hop is always vanilla.
            val entryObfs = extractObfsUapi(outerConfig)
            val entry = parseWgFields(outerConfig)
            val inner = parse(innerConfig) // wg-exit: AllowedIPs = 0.0.0.0/0, MTU 1340

            val exitPeer = inner.peers.first()
            val clientPriv = entry.priv
            val entryAssigned = entry.address
            val exitAssigned = inner.`interface`.addresses.first().address.hostAddress
            val entryIp = entry.endpointHost
            val entryPort = entry.endpointPort // 51821 for an obfuscated (awg) entry
            val exitIp = exitPeer.endpoint.get().host
            val exitDns = inner.`interface`.dnsServers.firstOrNull()?.hostAddress ?: "1.1.1.1"

            Log.i(TAG, "startMultihop: entry=$entryIp:$entryPort exit=$exitIp stealth=${entryObfs.isNotEmpty()}")

            val intent = Intent(context, CumulusMultihopVpnService::class.java).apply {
                action = CumulusMultihopVpnService.ACTION_START
                putExtra(CumulusMultihopVpnService.EXTRA_CLIENT_PRIV, clientPriv)
                putExtra(CumulusMultihopVpnService.EXTRA_ENTRY_PUB, entry.peerPub)
                putExtra(CumulusMultihopVpnService.EXTRA_ENTRY_IP, entryIp)
                putExtra(CumulusMultihopVpnService.EXTRA_ENTRY_ASSIGNED, entryAssigned)
                putExtra(CumulusMultihopVpnService.EXTRA_ENTRY_PORT, entryPort)
                putExtra(CumulusMultihopVpnService.EXTRA_ENTRY_OBFS, entryObfs)
                putExtra(CumulusMultihopVpnService.EXTRA_EXIT_PUB, exitPeer.publicKey.toBase64())
                putExtra(CumulusMultihopVpnService.EXTRA_EXIT_IP, exitIp)
                putExtra(CumulusMultihopVpnService.EXTRA_EXIT_ASSIGNED, exitAssigned)
                putExtra(CumulusMultihopVpnService.EXTRA_EXIT_DNS, exitDns)
                // Route text for the ongoing notification; blank = generic copy.
                putExtra(CumulusMultihopVpnService.EXTRA_NOTIF_TEXT, notifText)
                // Split tunneling: the inner (exit) config's AllowedIPs carries
                // the compiled tunnel routes (docs/17 §7.2). Default => absent.
                val innerAllowed = exitPeer.allowedIps.joinToString(", ") { it.toString() }
                if (innerAllowed.isNotEmpty() && !isFullTunnel(innerAllowed)) {
                    putExtra(CumulusMultihopVpnService.EXTRA_ROUTES4, innerAllowed)
                    putExtra(CumulusMultihopVpnService.EXTRA_ROUTES6, innerAllowed)
                }
                // Per-app rules (docs/17 §4.1), parsed by the official Config
                // parser from the inner config's [Interface] app keys.
                val included = inner.`interface`.includedApplications.joinToString(",")
                val excluded = inner.`interface`.excludedApplications.joinToString(",")
                if (included.isNotEmpty()) {
                    putExtra(CumulusMultihopVpnService.EXTRA_APPS_INCLUDED, included)
                }
                if (excluded.isNotEmpty()) {
                    putExtra(CumulusMultihopVpnService.EXTRA_APPS_EXCLUDED, excluded)
                }
            }
            multihopActive = true
            obfsActive = false // reciprocal: a multihop switch must not leave the obfs flag stale
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
            if (obfsActive) {
                val intent = Intent(context, CumulusObfsVpnService::class.java).apply {
                    action = CumulusObfsVpnService.ACTION_STOP
                }
                context.startService(intent)
                // onObfsState(DISCONNECTED) fires from the service's teardown.
            } else if (multihopActive) {
                val intent = Intent(context, CumulusMultihopVpnService::class.java).apply {
                    action = CumulusMultihopVpnService.ACTION_STOP
                }
                context.startService(intent)
                // onMultihopState(DISCONNECTED) fires from the service's teardown.
            } else {
                // Nothing running (or a stale flag): there is no other backend
                // to stop now that every transport rides wgnest.
                setState(STATE_DISCONNECTED)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "stopTunnel failed", t)
            setState(STATE_DISCONNECTED)
        }
    }

    /**
     * Live byte counters from the running device, or zeros when down.
     *
     * Both services read them straight from the wgnest Go core, so single-hop
     * now reports a real `lastHandshake` too — the old GoBackend path could
     * not (its per-peer handshake accessor differed across library versions).
     */
    fun statistics(context: Context): Stats {
        if (obfsActive) {
            return CumulusObfsVpnService.statistics()
        }
        if (multihopActive) {
            return CumulusMultihopVpnService.statistics()
        }
        return Stats(0, 0, 0)
    }

    /** True when an AllowedIPs value is the classic full tunnel (only default
     *  routes), i.e. no split policy is in effect. */
    private fun isFullTunnel(allowedIps: String): Boolean =
        allowedIps.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            .all { it == "0.0.0.0/0" || it == "::/0" }

    private fun parse(wgQuickConfig: String): Config =
        Config.parse(BufferedReader(StringReader(wgQuickConfig)))

    private fun setState(state: String) {
        currentStateValue = state
        listener?.onState(state)
    }

    /** Snapshot of live tunnel counters (bytes and unix-seconds handshake). */
    data class Stats(val rxBytes: Long, val txBytes: Long, val lastHandshake: Long)
}
