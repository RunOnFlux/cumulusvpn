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
        // full-tunnel config keeps this path byte-identical. v4 only, matching
        // the existing v4-only settings; the kill switch (`includeAllNetworks`)
        // disregards route carve-outs, so the app layer never combines the two.
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: serverIp)
        let ipv4 = NEIPv4Settings(addresses: [assigned], subnetMasks: ["255.255.255.255"])
        ipv4.includedRoutes = Self.includedV4Routes(allowedIps: conf.allowedIps)
        settings.ipv4Settings = ipv4
        settings.mtu = 1420
        if let dns = conf.dns {
            settings.dnsSettings = NEDNSSettings(servers: [dns])
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
        let exitDns = inner.dns ?? "1.1.1.1"
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
        ipv4.includedRoutes = Self.includedV4Routes(allowedIps: inner.allowedIps)
        ipv4.excludedRoutes = [NEIPv4Route(destinationAddress: entryIp, subnetMask: "255.255.255.255")]
        settings.ipv4Settings = ipv4
        settings.mtu = 1340
        settings.dnsSettings = NEDNSSettings(servers: [exitDns])

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
            self.log.log("nested tunnel up: entry=\(entryIp, privacy: .public) exit=\(exitIp, privacy: .public) handle=\(h)")
            completionHandler(nil)
            #else
            self.log.error("Wgnest unavailable — multihop not started")
            completionHandler(TunnelError.notImplemented)
            #endif
        }
    }

    override func stopTunnel(
        with _: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        #if canImport(Wgnest)
        if handle != 0 {
            WgmobileStop(handle)
            handle = 0
        }
        #endif
        tlsBridge?.stop()
        tlsBridge = nil
        completionHandler()
    }

    // Handle app→extension messages (a status/stats request forwarded from JS).
    override func handleAppMessage(
        _: Data,
        completionHandler: ((Data?) -> Void)?
    ) {
        #if canImport(Wgnest)
        if handle != 0 {
            // "rxBytes,txBytes,lastHandshakeSec"
            let csv = WgmobileGetStats(handle)
            completionHandler?(csv.data(using: .utf8))
            return
        }
        #endif
        completionHandler?(nil)
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
        let proto = protocolConfiguration as? NETunnelProviderProtocol
        return proto?.providerConfiguration?[key] as? String
    }

    /// The tun's IPv4 includedRoutes for a config's AllowedIPs list: the classic
    /// default route when the list is the full tunnel (or empty/absent — fail
    /// toward MORE protection), otherwise one route per v4 prefix. v6 entries
    /// are ignored (the extension programs v4-only settings today).
    static func includedV4Routes(allowedIps: [String]) -> [NEIPv4Route] {
        let v4 = allowedIps.filter { !$0.contains(":") }
        let isFullTunnel = v4.isEmpty || v4.contains("0.0.0.0/0")
        if isFullTunnel { return [NEIPv4Route.default()] }
        let routes = v4.compactMap(ipv4Route(_:))
        // A list that parses to nothing must not leave the tun carrying nothing.
        return routes.isEmpty ? [NEIPv4Route.default()] : routes
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
    let dns: String? // [Interface] DNS, first entry
    let endpointHost: String? // [Peer] Endpoint, port stripped
    let endpointPort: Int // [Peer] Endpoint port (0 if absent → engine default 51820)
    let obfs: String // AmneziaWG [Interface] params as device-level UAPI ("" = vanilla)
    let tlsSni: String? // wg-tls: present → bridge over TLS (the `CVPN_TLS_SNI` sentinel)
    let allowedIps: [String] // [Peer] AllowedIPs entries, trimmed ("0.0.0.0/0", …)

    // AmneziaWG [Interface] keys (lowercased), emitted as UAPI in this order.
    private static let obfsKeys = ["jc", "jmin", "jmax", "s1", "s2", "h1", "h2", "h3", "h4"]

    init?(_ text: String) {
        var priv: String?
        var pub: String?
        var addr: String?
        var dns: String?
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
                dns = val.split(separator: ",").first.map {
                    String($0).trimmingCharacters(in: .whitespaces)
                }
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
