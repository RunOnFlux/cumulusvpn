// PacketTunnelProvider.swift
//
// iOS Network Extension that runs the CumulusVPN data plane. BOTH single-hop and
// multi-hop run through the ONE wgnest Go core (Wgmobile* — two stacked
// wireguard-go devices for multi-hop, a single device for single-hop). It does
// NOT link WireGuardKit's libwg-go: two independent Go runtimes in one extension
// process crash it (EXC_BAD_ACCESS on tunnel start — see docs/13). WireGuardKitC
// is still linked, but it is C-only (the utun-control types) — no Go runtime.
//
// Fed a rendered wg-quick config through NETunnelProviderProtocol.providerConfiguration:
//   - single-hop:  { "wgConfig": <conf> }
//   - multi-hop:   { "mode": "multihop", "outerConfig": <conf>, "innerConfig": <conf> }
//
// Kill switch: the app never stops this session to change route. A country
// switch, a failover or a transport fallback arrives as a SWAP app message and
// is applied inside the running session; a dead tunnel is HELD (engine stopped,
// utun kept). Either way the utun stays up, so with `includeAllNetworks` iOS
// keeps every packet in it — nothing leaks between two routes. Only the app's
// Disconnect (stopVPNTunnel) ends the session. See `handleAppMessage`.

import Foundation
import Network
import NetworkExtension
import os

// WireGuardKitC vends the patched ctl_info / sockaddr_ctl / CTLIOCGINFO used by
// tunnelFileDescriptor (the utun-fd scan). C only — brings no Go runtime.
#if canImport(WireGuardKitC)
import WireGuardKitC
#endif

// Wgnest.xcframework — the gomobile-built core (wireguard-go + gVisor netstack).
// Built by clients/native/wgnest/build-ios.sh.
#if canImport(Wgnest)
import Wgnest
#endif

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let log = Logger(subsystem: "com.cumulusvpn.tunnel", category: "PacketTunnel")

    // wgnest handle (single- OR multi-hop); 0 while down. Passed to WgmobileStop.
    private var handle: Int64 = 0

    // wg-tls transport: the UDP<->TLS bridge, kept alive for the session (the WG
    // device dials its local UDP endpoint). nil for vanilla/awg.
    private var tlsBridge: WgTlsBridge?

    // Roam detection. See `startPathMonitor()` for what a roam does to a tunnel
    // and why the two transports need different answers.
    private var pathMonitor: NWPathMonitor?
    private let pathQueue = DispatchQueue(label: "com.cumulusvpn.tunnel.path")
    private var lastPathInterfaces: [NWInterface]?

    // The route a swap installed, overriding the saved providerConfiguration
    // (which only changes when the app starts a fresh session). nil = use the
    // saved one. Read through `providerConfigValue(forKey:)`.
    private var activeConfig: [String: String]?

    // Swaps are serialized on the main queue: two engines on one utun would both
    // read it. A swap arriving while one is running waits here; only the newest
    // one is kept, and the superseded caller is told so.
    private var swapInFlight = false
    private var queuedSwap: (config: [String: String], reply: (String) -> Void)?
    // A hold that arrived mid-swap: applied as soon as that swap finishes.
    private var holdAfterSwap = false

    // Called by the OS when the user (or the app) starts the tunnel.
    override func startTunnel(
        options _: [String: NSObject]?,
        completionHandler: @escaping (Error?) -> Void
    ) {
        let mode = providerConfigValue(forKey: "mode") ?? "single"
        if mode == "multihop" {
            startMultihop(completionHandler: completionHandler)
        } else {
            startSingleHop(completionHandler: completionHandler)
        }
    }

    // MARK: - single-hop

    private func startSingleHop(completionHandler: @escaping (Error?) -> Void) {
        guard
            let confStr = providerConfigValue(forKey: "wgConfig"),
            let conf = WgQuick(confStr),
            let serverIp = conf.endpointHost,
            let assigned = conf.address
        else {
            completionHandler(TunnelError.invalidConfig)
            return
        }

        // One WireGuard header of headroom (MTU 1420); assigned addr + DNS +
        // default route. iOS excludes the provider's own UDP socket from the tun,
        // so no excludedRoutes are needed for the single real socket.
        //
        // Split tunneling (docs/17): a non-default AllowedIPs (core's compiled
        // split policy, the pre-computed complement / inclusion list) becomes the
        // includedRoutes set — only those prefixes enter the tun. The classic
        // full-tunnel config keeps this path byte-identical. IPv6 is blackholed
        // into the tun (`ipv6Settings`); the kill switch (`includeAllNetworks`)
        // disregards route carve-outs, so the app layer never combines the two.
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: serverIp)
        let ipv4 = NEIPv4Settings(addresses: [assigned], subnetMasks: ["255.255.255.255"])
        ipv4.includedRoutes = Self.includedV4Routes(allowedIps: conf.allowedIps, dnsServers: conf.dns)
        settings.ipv4Settings = ipv4
        settings.ipv6Settings = Self.ipv6Settings(allowedIps: conf.allowedIps)
        settings.mtu = 1420
        if !conf.dns.isEmpty {
            settings.dnsSettings = Self.dnsSettings(servers: conf.dns)
        }

        setTunnelNetworkSettings(settings) { [weak self] error in
            guard let self else { return }
            if let error {
                self.log.error("single setTunnelNetworkSettings failed: \(String(describing: error))")
                completionHandler(error)
                return
            }
            guard let fd = self.tunnelFileDescriptor else {
                self.log.error("single: could not locate tun fd")
                completionHandler(TunnelError.invalidConfig)
                return
            }

            // wg-tls: stand up the UDP<->TLS bridge to the gateway relay and point
            // the WG device at its LOCAL udp endpoint (the relay is the config
            // Endpoint — gateway:tlsPort). The bridge's TLS socket is the
            // provider's own, so iOS keeps it off the tun (no loop). obfs is empty
            // (the TLS wrapper IS the obfuscation, not [Interface] params).
            if let sni = conf.tlsSni {
                let relayPort = UInt16(conf.endpointPort == 0 ? 51820 : conf.endpointPort)
                let bridge = WgTlsBridge()
                self.tlsBridge = bridge
                bridge.start(
                    relayHost: serverIp,
                    relayPort: relayPort,
                    sni: sni,
                    onReady: { [weak self] localPort in
                        guard let self else { return }
                        self.log.log("wg-tls bridge up: relay=\(serverIp, privacy: .public):\(relayPort) local=\(localPort)")
                        self.startWgSingle(
                            fd: fd, priv: conf.privateKey, pub: conf.peerPublicKey,
                            serverIp: "127.0.0.1", assigned: assigned,
                            port: Int(localPort), obfs: "", completionHandler: completionHandler
                        )
                    },
                    onError: { [weak self] err in
                        self?.log.error("wg-tls bridge failed: \(String(describing: err), privacy: .public)")
                        self?.tlsBridge?.stop()
                        self?.tlsBridge = nil
                        completionHandler(err)
                    }
                )
                return
            }

            // Vanilla / awg: the WG device dials the gateway directly over UDP.
            self.startWgSingle(
                fd: fd, priv: conf.privateKey, pub: conf.peerPublicKey,
                serverIp: serverIp, assigned: assigned,
                port: conf.endpointPort, obfs: conf.obfs, completionHandler: completionHandler
            )
        }
    }

    /// Configure the single wgnest device against `serverIp:port` (the gateway for
    /// vanilla/awg, or `127.0.0.1:<bridgePort>` for wg-tls).
    private func startWgSingle(
        fd: Int32, priv: String, pub: String, serverIp: String, assigned: String,
        port: Int, obfs: String, completionHandler: @escaping (Error?) -> Void
    ) {
        #if canImport(Wgnest)
        var h: Int64 = 0
        var startErr: NSError?
        let ok = WgmobileStartSingle(priv, pub, serverIp, assigned, Int(fd), port, obfs, &h, &startErr)
        if !ok || startErr != nil {
            self.log.error("single WgmobileStartSingle failed: \(String(describing: startErr), privacy: .public)")
            self.tlsBridge?.stop()
            self.tlsBridge = nil
            completionHandler(startErr ?? TunnelError.notImplemented)
            return
        }
        self.handle = h
        self.startPathMonitor()
        self.log.log("single-hop up: server=\(serverIp, privacy: .public) handle=\(h)")
        completionHandler(nil)
        #else
        self.log.error("Wgnest unavailable — single-hop not started")
        completionHandler(TunnelError.notImplemented)
        #endif
    }

    // MARK: - multi-hop (nested onion, docs/11)

    // Two stacked WireGuard interfaces sharing the client key K:
    //   OS tun (0.0.0.0/0, MTU 1340) → INNER (peer = EXIT) → UDP to <exitIp>:51820
    //     ─ via ─→ OUTER (peer = ENTRY, AllowedIPs = <exitIp>/32) → real socket → ENTRY.
    // The ENTRY operator only forwards ciphertext to another gateway's :51820 — it
    // never sees the real destination. No gateway protocol change (docs/11).
    private func startMultihop(completionHandler: @escaping (Error?) -> Void) {
        guard
            let outerStr = providerConfigValue(forKey: "outerConfig"),
            let innerStr = providerConfigValue(forKey: "innerConfig"),
            let outer = WgQuick(outerStr),
            let inner = WgQuick(innerStr),
            let entryIp = outer.endpointHost,
            let exitIp = inner.endpointHost,
            let entryAssigned = outer.address,
            let exitAssigned = inner.address
        else {
            completionHandler(TunnelError.invalidConfig)
            return
        }
        let clientPriv = outer.privateKey
        let entryPub = outer.peerPublicKey
        let exitPub = inner.peerPublicKey
        let exitDns = inner.dns.isEmpty ? ["1.1.1.1"] : inner.dns
        log.log("multihop: entry=\(entryIp, privacy: .public) exit=\(exitIp, privacy: .public)")

        // Exit-assigned address, exit DNS, MTU 1340 (two stacked WG headers).
        // Route everything into the tun EXCEPT the entry IP, so the outer device's
        // one real socket to the entry bypasses the tun (no loop).
        //
        // Split tunneling (docs/17 §7.2): the INNER (exit) config's AllowedIPs
        // carries the compiled tunnel routes; non-default → includedRoutes. The
        // compile step rejects rules containing either hop IP, so the entry-pin
        // exclusion below can never be shadowed.
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: entryIp)
        let ipv4 = NEIPv4Settings(addresses: [exitAssigned], subnetMasks: ["255.255.255.255"])
        ipv4.includedRoutes = Self.includedV4Routes(allowedIps: inner.allowedIps, dnsServers: exitDns)
        ipv4.excludedRoutes = [NEIPv4Route(destinationAddress: entryIp, subnetMask: "255.255.255.255")]
        settings.ipv4Settings = ipv4
        settings.ipv6Settings = Self.ipv6Settings(allowedIps: inner.allowedIps)
        settings.mtu = 1340
        settings.dnsSettings = Self.dnsSettings(servers: exitDns)

        setTunnelNetworkSettings(settings) { [weak self] error in
            guard let self else { return }
            if let error {
                self.log.error("multihop setTunnelNetworkSettings failed: \(String(describing: error))")
                completionHandler(error)
                return
            }
            guard let fd = self.tunnelFileDescriptor else {
                self.log.error("multihop: could not locate tun fd")
                completionHandler(TunnelError.invalidConfig)
                return
            }
            #if canImport(Wgnest)
            var h: Int64 = 0
            var startErr: NSError?
            let ok = WgmobileStart(
                clientPriv, entryPub, entryIp, entryAssigned,
                exitPub, exitIp, exitAssigned,
                Int(fd), outer.endpointPort, outer.obfs, &h, &startErr
            )
            if !ok || startErr != nil {
                self.log.error("multihop WgmobileStart failed: \(String(describing: startErr), privacy: .public)")
                completionHandler(startErr ?? TunnelError.notImplemented)
                return
            }
            self.handle = h
            self.startPathMonitor()
            self.log.log("nested tunnel up: entry=\(entryIp, privacy: .public) exit=\(exitIp, privacy: .public) handle=\(h)")
            completionHandler(nil)
            #else
            self.log.error("Wgnest unavailable — multihop not started")
            completionHandler(TunnelError.notImplemented)
            #endif
        }
    }

    /// Watch for the device changing network and repair the tunnel.
    ///
    /// WireGuard roams by design, but only the server half is free: a gateway
    /// relearns a peer's endpoint from any authenticated packet, so a session
    /// resumes the moment one datagram arrives from the new address. The client
    /// half is not free. Its UDP socket stays bound to the interface that went
    /// away, so nothing is ever sent and the gateway never learns anything —
    /// while iOS keeps the tunnel "connected" because the utun is still up. The
    /// app's auto-reconnect watches for a disconnect that never comes.
    ///
    /// Interfaces, not `path.status`, are what we compare. A Wi-Fi to cellular
    /// switch keeps the path `.satisfied` throughout; only the interface list
    /// changes. Watching status alone would miss the most common roam there is.
    private func startPathMonitor() {
        let monitor = NWPathMonitor()
        pathMonitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            guard path.status == .satisfied else { return }
            let interfaces = path.availableInterfaces
            defer { self.lastPathInterfaces = interfaces }
            guard let previous = self.lastPathInterfaces else {
                return // first callback describes the network we started on
            }
            if previous.map(\.name) == interfaces.map(\.name) {
                return
            }
            self.log.log("roam: \(previous.map(\.name).joined(separator: ","), privacy: .public) -> \(interfaces.map(\.name).joined(separator: ","), privacy: .public)")
            self.handleRoam()
        }
        monitor.start(queue: pathQueue)
    }

    private func stopPathMonitor() {
        pathMonitor?.cancel()
        pathMonitor = nil
        lastPathInterfaces = nil
    }

    /// Two transports, two answers, because they break differently.
    ///
    /// **vanilla / awg (UDP)** — only the client's socket is stale. `Rebind`
    /// reopens it on the new interface and clears the peer's cached source
    /// address, so the next keepalive (every 15s) leaves from the new address
    /// and the gateway relearns the endpoint. Keys, session and counters all
    /// survive; nothing re-handshakes.
    ///
    /// **wg-tls** — rebinding is useless. That device points at 127.0.0.1 and
    /// the socket that actually died is the bridge's TCP connection to the
    /// relay, which cannot migrate between networks. The route is rebuilt in
    /// place (a fresh bridge + engine on the same utun), so the session — and
    /// with it the kill switch — never drops. If the rebuild fails the engine
    /// stays stopped and the utun keeps blocking; the app's dead-tunnel check
    /// then fails over to another node.
    private func handleRoam() {
        guard handle != 0 else { return }
        if tlsBridge != nil {
            log.log("roam on wg-tls — rebuilding the bridge in place (the relay's TCP cannot follow)")
            DispatchQueue.main.async {
                self.swap(to: self.currentConfig()) { _ in }
            }
            return
        }
        #if canImport(Wgnest)
        // Package-level Go funcs bind as C functions, so the error arrives via
        // an out-param plus a Bool — the same shape as WgmobileStartSingle
        // above, not a Swift `throws`.
        var err: NSError?
        let ok = WgmobileRebind(handle, &err)
        if !ok || err != nil {
            // The new interface was not usable yet; a further path update
            // follows when it is.
            log.error("rebind after roam failed: \(String(describing: err), privacy: .public)")
        } else {
            log.log("roam — UDP socket rebound, handle=\(self.handle)")
        }
        #endif
    }

    override func stopTunnel(
        with _: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        stopEngine()
        completionHandler()
    }

    /// Stop the WireGuard engine, its TLS bridge and the roam watcher, leaving
    /// the utun (owned by the session, not by wgnest — it works on a dup) up.
    /// With nothing reading the utun, every packet routed into it is dropped:
    /// this is the HELD state.
    private func stopEngine() {
        stopPathMonitor()
        #if canImport(Wgnest)
        if handle != 0 {
            WgmobileStop(handle)
            handle = 0
        }
        #endif
        tlsBridge?.stop()
        tlsBridge = nil
    }

    // MARK: - app messages

    /// App → extension messages. The first byte is the command:
    ///   0x01  stats   → "rxBytes,txBytes,lastHandshakeSec", or "held" when the
    ///                   session is up with no engine running
    ///   0x02  swap    + JSON providerConfiguration → "ok" | "err:<message>"
    ///   0x03  hold    → "ok"
    ///   0x04  fetch   + JSON {url, method, headers, body(base64)} →
    ///                   JSON {status, headers, body(base64)} | {error}
    ///
    /// Swap and hold are how the kill switch survives a route change (see the
    /// file header). Fetch exists for the HELD state: with `includeAllNetworks`
    /// the app's own requests are blocked too, but the provider's sockets are
    /// not, so the app sends its gateway enroll requests through here to find
    /// its way back. An empty message is a stats request (older app builds).
    override func handleAppMessage(
        _ messageData: Data,
        completionHandler: ((Data?) -> Void)?
    ) {
        let command = messageData.first ?? 0x01
        let payload = messageData.dropFirst()
        let reply: (String) -> Void = { completionHandler?($0.data(using: .utf8)) }
        switch command {
        case 0x02:
            guard let config = Self.decodeConfig(payload) else {
                reply("err:invalid route")
                return
            }
            DispatchQueue.main.async { self.swap(to: config, reply: reply) }
        case 0x03:
            DispatchQueue.main.async {
                self.queuedSwap?.reply("err:superseded")
                self.queuedSwap = nil
                if self.swapInFlight {
                    self.holdAfterSwap = true
                } else {
                    self.stopEngine()
                }
                self.log.log("held: engine stopped, utun kept")
                reply("ok")
            }
        case 0x04:
            GatewayFetch.perform(payload) { completionHandler?($0) }
        default:
            #if canImport(Wgnest)
            if handle != 0 {
                reply(WgmobileGetStats(handle))
                return
            }
            #endif
            reply("held")
        }
    }

    /// Replace the running route with `config` inside this session. The old
    /// engine stops first, then the new route's network settings and engine
    /// come up on the same utun; in between, the utun drops traffic (held).
    /// On failure the session stays HELD rather than ending — ending it is what
    /// would let traffic out.
    private func swap(to config: [String: String], reply: @escaping (String) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        if swapInFlight {
            queuedSwap?.reply("err:superseded")
            queuedSwap = (config, reply)
            holdAfterSwap = false
            return
        }
        swapInFlight = true
        stopEngine()
        activeConfig = config
        reasserting = true
        let finish: (Error?) -> Void = { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.reasserting = false
                self.swapInFlight = false
                if let error {
                    self.log.error("swap failed, holding: \(String(describing: error), privacy: .public)")
                    reply("err:\(error.localizedDescription)")
                } else {
                    self.log.log("swap done")
                    reply("ok")
                }
                if let next = self.queuedSwap {
                    self.queuedSwap = nil
                    self.swap(to: next.config, reply: next.reply)
                } else if self.holdAfterSwap {
                    self.holdAfterSwap = false
                    self.stopEngine()
                    self.log.log("held after swap: engine stopped, utun kept")
                }
            }
        }
        if config["mode"] == "multihop" {
            startMultihop(completionHandler: finish)
        } else {
            startSingleHop(completionHandler: finish)
        }
    }

    /// The route currently in force: the last swap's, else the saved one.
    private func currentConfig() -> [String: String] {
        if let activeConfig { return activeConfig }
        let proto = protocolConfiguration as? NETunnelProviderProtocol
        var out: [String: String] = [:]
        for (key, value) in proto?.providerConfiguration ?? [:] {
            if let value = value as? String { out[key] = value }
        }
        return out
    }

    private static func decodeConfig(_ data: Data.SubSequence) -> [String: String]? {
        guard
            let object = try? JSONSerialization.jsonObject(with: Data(data)),
            let dict = object as? [String: String],
            dict["wgConfig"] != nil || dict["mode"] == "multihop"
        else { return nil }
        return dict
    }

    // MARK: - helpers

    /// Locate the utun file descriptor backing this extension's packet flow — the
    /// canonical WireGuardKit scan: find the fd whose kernel control is the utun
    /// control. Only valid after `setTunnelNetworkSettings` has established the tun.
    private var tunnelFileDescriptor: Int32? {
        var ctlInfo = ctl_info()
        withUnsafeMutablePointer(to: &ctlInfo.ctl_name) {
            $0.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: $0.pointee)) {
                _ = strcpy($0, "com.apple.net.utun_control")
            }
        }
        for fd: Int32 in 0...1024 {
            var addr = sockaddr_ctl()
            var ret: Int32 = -1
            var len = socklen_t(MemoryLayout.size(ofValue: addr))
            withUnsafeMutablePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    ret = getpeername(fd, $0, &len)
                }
            }
            if ret != 0 || addr.sc_family != AF_SYSTEM { continue }
            if ctlInfo.ctl_id == 0 {
                if ioctl(fd, CTLIOCGINFO, &ctlInfo) != 0 { continue }
            }
            if addr.sc_id == ctlInfo.ctl_id { return fd }
        }
        return nil
    }

    private func providerConfigValue(forKey key: String) -> String? {
        if let activeConfig { return activeConfig[key] }
        let proto = protocolConfiguration as? NETunnelProviderProtocol
        return proto?.providerConfiguration?[key] as? String
    }

    /// The tun's IPv4 includedRoutes for a config's AllowedIPs list: the classic
    /// default route when the list is the full tunnel (or empty/absent — fail
    /// toward MORE protection), otherwise one route per v4 prefix. v6 entries
    /// are handled by `ipv6Settings`.
    ///
    /// A split list also gains a host route for every resolver it doesn't
    /// already span: lookups go to the tunnel's resolver (docs/17 §6.5), and an
    /// "Only these" list — or an exclude rule covering the chosen provider —
    /// would otherwise send them out on the physical network in the clear.
    static func includedV4Routes(allowedIps: [String], dnsServers: [String] = []) -> [NEIPv4Route] {
        let v4 = allowedIps.filter { !$0.contains(":") }
        let isFullTunnel = v4.isEmpty || v4.contains("0.0.0.0/0")
        if isFullTunnel { return [NEIPv4Route.default()] }
        let routes = v4.compactMap(ipv4Route(_:))
        // A list that parses to nothing must not leave the tun carrying nothing.
        if routes.isEmpty { return [NEIPv4Route.default()] }
        let dnsRoutes = dnsServers
            .filter { server in
                guard let ip = ipv4Value(server) else { return false }
                return !v4.contains { covers($0, ip) }
            }
            .compactMap(ipv4Route(_:)) // a bare address is a /32
        return routes + dnsRoutes
    }

    /// The tun's IPv6 settings for a config's AllowedIPs list, mirroring Android
    /// (CumulusObfsVpnService): the full tunnel takes the v6 default route so
    /// IPv6 can't leave on the physical network with the real address — the
    /// gateways don't route v6 yet, so it is dropped there and apps fall back
    /// to v4. A split list keeps only its own v6 prefixes, as the policy says;
    /// none → nil (v6 bypasses, matching Android's split path).
    ///
    /// The address is a ULA, so address selection (RFC 6724) still prefers v4
    /// for global destinations instead of stalling on v6 first.
    static func ipv6Settings(allowedIps: [String]) -> NEIPv6Settings? {
        let v4 = allowedIps.filter { !$0.contains(":") }
        let isFullTunnel = v4.isEmpty || v4.contains("0.0.0.0/0")
        let routes: [NEIPv6Route]
        if isFullTunnel {
            routes = [NEIPv6Route.default()]
        } else {
            routes = allowedIps.filter { $0.contains(":") }.compactMap(ipv6Route(_:))
            if routes.isEmpty { return nil }
        }
        let ipv6 = NEIPv6Settings(addresses: [tunnelV6Address], networkPrefixLengths: [128])
        ipv6.includedRoutes = routes
        return ipv6
    }

    /// The tun's own IPv6 address (ULA, same as Android's TunnelHold).
    private static let tunnelV6Address = "fd00:6375:6d75::1"

    /// "x::y/n" (or a bare address = /128) → NEIPv6Route, nil when malformed.
    private static func ipv6Route(_ cidr: String) -> NEIPv6Route? {
        let parts = cidr.split(separator: "/")
        guard let addr = parts.first.map(String.init) else { return nil }
        let prefix = parts.count > 1 ? Int(parts[1]) ?? -1 : 128
        var buf = in6_addr()
        guard (0...128).contains(prefix), inet_pton(AF_INET6, addr, &buf) == 1 else { return nil }
        return NEIPv6Route(destinationAddress: addr, networkPrefixLength: NSNumber(value: prefix))
    }

    /// The tun's resolvers: every server of the config's `DNS =` list (the
    /// user's DNS choice), primary first. `matchDomains = [""]` makes them
    /// answer ALL lookups — without it iOS only treats them as the default
    /// resolver while the tunnel holds the default route, so a split policy
    /// would quietly hand lookups to the network's resolver. (WireGuardKit's
    /// PacketTunnelSettingsGenerator sets the same.)
    private static func dnsSettings(servers: [String]) -> NEDNSSettings {
        let dns = NEDNSSettings(servers: servers)
        dns.matchDomains = [""]
        return dns
    }

    /// A dotted-quad as a host-order integer, nil when it isn't one.
    private static func ipv4Value(_ s: String) -> UInt32? {
        var addr = in_addr()
        guard inet_pton(AF_INET, s, &addr) == 1 else { return nil }
        return UInt32(bigEndian: addr.s_addr)
    }

    /// True when the v4 CIDR `cidr` ("a.b.c.d/n", bare = /32) contains `ip`.
    private static func covers(_ cidr: String, _ ip: UInt32) -> Bool {
        let parts = cidr.split(separator: "/")
        guard let net = parts.first.flatMap({ ipv4Value(String($0)) }) else { return false }
        let prefix = parts.count > 1 ? Int(parts[1]) ?? -1 : 32
        guard (0...32).contains(prefix) else { return false }
        let mask: UInt32 = prefix == 0 ? 0 : ~UInt32(0) << (32 - prefix)
        return net & mask == ip & mask
    }

    /// "a.b.c.d/n" (or a bare address = /32) → NEIPv4Route, nil when malformed.
    private static func ipv4Route(_ cidr: String) -> NEIPv4Route? {
        let parts = cidr.split(separator: "/")
        guard let addr = parts.first.map(String.init), !addr.isEmpty else { return nil }
        let prefix = parts.count > 1 ? Int(parts[1]) ?? -1 : 32
        guard (0...32).contains(prefix), inet_addr(addr) != INADDR_NONE || addr == "255.255.255.255"
        else { return nil }
        let maskBits: UInt32 = prefix == 0 ? 0 : ~UInt32(0) << (32 - prefix)
        let mask = [24, 16, 8, 0].map { String((maskBits >> $0) & 0xFF) }.joined(separator: ".")
        return NEIPv4Route(destinationAddress: addr, subnetMask: mask)
    }

    enum TunnelError: Error {
        case missingConfig
        case invalidConfig
        case notImplemented
    }
}

/// Minimal wg-quick config parser — the few fields wgnest needs, without pulling
/// in WireGuardKit's `TunnelConfiguration` (which would link libwg-go). Handles
/// the exact configs core renders (buildWgConfig / buildMultihopConfig).
private struct WgQuick {
    let privateKey: String // [Interface] PrivateKey, base64
    let peerPublicKey: String // [Peer] PublicKey, base64
    let address: String? // [Interface] Address, first IP, mask stripped
    let dns: [String] // [Interface] DNS, every entry, trimmed, in order ([] if absent)
    let endpointHost: String? // [Peer] Endpoint, port stripped
    let endpointPort: Int // [Peer] Endpoint port (0 if absent → engine default 51820)
    let obfs: String // AmneziaWG [Interface] params as device-level UAPI ("" = vanilla)
    let tlsSni: String? // wg-tls: present → bridge over TLS (the `CVPN_TLS_SNI` sentinel)
    let allowedIps: [String] // [Peer] AllowedIPs entries, trimmed ("0.0.0.0/0", …)

    // AmneziaWG [Interface] keys (lowercased), emitted as UAPI in this order.
    private static let obfsKeys = ["jc", "jmin", "jmax", "s1", "s2", "h1", "h2", "h3", "h4"]

    /// True for a bare IPv4 or IPv6 address literal.
    private static func isIpLiteral(_ s: String) -> Bool {
        var v4 = in_addr()
        var v6 = in6_addr()
        return inet_pton(AF_INET, s, &v4) == 1 || inet_pton(AF_INET6, s, &v6) == 1
    }

    init?(_ text: String) {
        var priv: String?
        var pub: String?
        var addr: String?
        var dns: [String] = []
        var endpoint: String?
        var sni: String?
        var allowed: [String] = []
        var obfsVals: [String: String] = [:]
        for raw in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = line[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
            let val = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            switch key {
            case "privatekey": priv = val
            case "publickey": pub = val
            case "address":
                // "10.8.0.2/32" (or comma-separated) → first IP, mask stripped.
                let first = val.split(separator: ",").first.map(String.init) ?? val
                addr = first.split(separator: "/").first.map(String.init)
            case "dns":
                // "9.9.9.9, 149.112.112.112" — a DNS choice can name two; keep
                // all. Only IP literals: a wg-quick DNS line may also carry
                // search domains, which are no use as NEDNSSettings servers.
                dns = val.split(separator: ",")
                    .map { String($0).trimmingCharacters(in: .whitespaces) }
                    .filter(WgQuick.isIpLiteral(_:))
            case "endpoint": endpoint = val
            case "allowedips":
                // Split tunneling: the compiled route list ("0.0.0.0/5, 8.0.0.0/7, …").
                allowed = val.split(separator: ",").map {
                    String($0).trimmingCharacters(in: .whitespaces)
                }
            case "jc", "jmin", "jmax", "s1", "s2", "h1", "h2", "h3", "h4":
                obfsVals[key] = val
            // wg-tls sentinel injected by the client (useVpn) — signals that the
            // Endpoint is a TLS relay to bridge to, carrying the SNI to present.
            // Namespaced so it can't collide with a real wg-quick key; the WG UAPI
            // is built from the parsed fields, so it never reaches wgnest.
            case "cvpn_tls_sni": sni = val
            default: break
            }
        }
        guard let priv, let pub else { return nil }
        privateKey = priv
        peerPublicKey = pub
        address = addr
        self.dns = dns
        tlsSni = sni
        allowedIps = allowed
        // Split "ip:port" (our gateways are IPv4 literals); keep both parts.
        if let endpoint, let colon = endpoint.lastIndex(of: ":") {
            endpointHost = String(endpoint[..<colon])
            endpointPort = Int(endpoint[endpoint.index(after: colon)...]) ?? 0
        } else {
            endpointHost = endpoint
            endpointPort = 0
        }
        // Device-level obfuscation UAPI (jc=…\n…), in a fixed order; "" when the
        // config carries no AmneziaWG params (vanilla / wg-tls).
        obfs = WgQuick.obfsKeys.compactMap { k in obfsVals[k].map { "\(k)=\($0)" } }
            .joined(separator: "\n")
            .appending(obfsVals.isEmpty ? "" : "\n")
    }
}

/// The HELD state's way out (see `handleAppMessage` 0x04): one plain HTTP/1.1
/// request to a gateway's control API, sent from the provider's own socket so
/// it bypasses the blocking utun that `includeAllNetworks` holds the app to.
///
/// Raw `NWConnection` rather than URLSession: the control API is plain HTTP on
/// a bare IP, exactly what the app already sends, and every response body is
/// Ed25519-signed by the gateway and verified in the app (core `fetchSigned`),
/// so this relays bytes without being trusted with them. Only `http://` is
/// accepted.
private enum GatewayFetch {
    private static let queue = DispatchQueue(label: "com.cumulusvpn.tunnel.fetch")
    private static let timeout: TimeInterval = 20
    private static let maxResponse = 1 << 20

    static func perform(_ payload: Data.SubSequence, reply: @escaping (Data?) -> Void) {
        let fail: (String) -> Void = { message in
            reply(try? JSONSerialization.data(withJSONObject: ["error": message]))
        }
        guard
            let object = try? JSONSerialization.jsonObject(with: Data(payload)) as? [String: Any],
            let urlString = object["url"] as? String,
            let url = URL(string: urlString),
            url.scheme == "http",
            let host = url.host,
            let port = NWEndpoint.Port(rawValue: UInt16(url.port ?? 80))
        else {
            fail("unsupported request")
            return
        }
        let method = (object["method"] as? String ?? "GET").uppercased()
        let headers = object["headers"] as? [String: String] ?? [:]
        let body = (object["body"] as? String).flatMap { Data(base64Encoded: $0) } ?? Data()
        var path = url.path.isEmpty ? "/" : url.path
        if let query = url.query { path += "?\(query)" }

        var head = "\(method) \(path) HTTP/1.1\r\nHost: \(host):\(port.rawValue)\r\nConnection: close\r\n"
        for (name, value) in headers where !["host", "connection", "content-length"].contains(name.lowercased()) {
            head += "\(name): \(value)\r\n"
        }
        if !body.isEmpty || method == "POST" || method == "PUT" {
            head += "Content-Length: \(body.count)\r\n"
        }
        head += "\r\n"
        var request = Data(head.utf8)
        request.append(body)

        let conn = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
        var done = false
        let finish: (Data?) -> Void = { data in
            queue.async {
                guard !done else { return }
                done = true
                conn.cancel()
                reply(data)
            }
        }
        queue.asyncAfter(deadline: .now() + timeout) {
            if !done { fail("timed out"); done = true; conn.cancel() }
        }
        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                conn.send(content: request, completion: .contentProcessed { error in
                    if let error { finish(errorJSON(error.localizedDescription)) }
                })
                receive(conn, into: Data(), finish: finish)
            case .failed(let error), .waiting(let error):
                finish(errorJSON(error.localizedDescription))
            default:
                break
            }
        }
        conn.start(queue: queue)
    }

    private static func receive(_ conn: NWConnection, into buffer: Data, finish: @escaping (Data?) -> Void) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { chunk, _, isComplete, error in
            var buffer = buffer
            if let chunk { buffer.append(chunk) }
            if buffer.count > maxResponse {
                finish(errorJSON("response too large"))
            } else if isComplete || error != nil {
                finish(parse(buffer) ?? errorJSON(error?.localizedDescription ?? "malformed response"))
            } else {
                receive(conn, into: buffer, finish: finish)
            }
        }
    }

    /// Status line + headers + body (Content-Length, chunked, or to close).
    static func parse(_ raw: Data) -> Data? {
        let separator = Data("\r\n\r\n".utf8)
        guard
            let split = raw.range(of: separator),
            let head = String(data: raw[..<split.lowerBound], encoding: .utf8)
        else { return nil }
        var lines = head.components(separatedBy: "\r\n")
        let statusLine = lines.removeFirst().split(separator: " ")
        guard statusLine.count >= 2, let status = Int(statusLine[1]) else { return nil }
        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces)
            headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        var body = Data(raw[split.upperBound...])
        let header: (String) -> String? = { name in
            headers.first { $0.key.lowercased() == name }?.value
        }
        if header("transfer-encoding")?.lowercased().contains("chunked") == true {
            guard let decoded = dechunk(body) else { return nil }
            body = decoded
        } else if let length = header("content-length").flatMap(Int.init), length <= body.count {
            body = body.prefix(length)
        }
        return try? JSONSerialization.data(withJSONObject: [
            "status": status,
            "headers": headers,
            "body": body.base64EncodedString(),
        ])
    }

    private static func dechunk(_ data: Data) -> Data? {
        var out = Data()
        var rest = data[...]
        let crlf = Data("\r\n".utf8)
        while true {
            guard
                let lineEnd = rest.range(of: crlf),
                let sizeLine = String(data: rest[..<lineEnd.lowerBound], encoding: .utf8),
                let size = Int(sizeLine.split(separator: ";")[0].trimmingCharacters(in: .whitespaces), radix: 16)
            else { return nil }
            let start = lineEnd.upperBound
            if size == 0 { return out }
            guard rest.distance(from: start, to: rest.endIndex) >= size + 2 else { return nil }
            let end = rest.index(start, offsetBy: size)
            out.append(rest[start..<end])
            rest = rest[rest.index(end, offsetBy: 2)...]
        }
    }

    private static func errorJSON(_ message: String) -> Data? {
        try? JSONSerialization.data(withJSONObject: ["error": message])
    }
}
