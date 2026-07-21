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
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: serverIp)
        let ipv4 = NEIPv4Settings(addresses: [assigned], subnetMasks: ["255.255.255.255"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
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
            #if canImport(Wgnest)
            var h: Int64 = 0
            var startErr: NSError?
            let ok = WgmobileStartSingle(
                conf.privateKey, conf.peerPublicKey, serverIp, assigned, Int(fd), &h, &startErr
            )
            if !ok || startErr != nil {
                self.log.error("single WgmobileStartSingle failed: \(String(describing: startErr), privacy: .public)")
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
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: entryIp)
        let ipv4 = NEIPv4Settings(addresses: [exitAssigned], subnetMasks: ["255.255.255.255"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
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
                Int(fd), &h, &startErr
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

    init?(_ text: String) {
        var priv: String?
        var pub: String?
        var addr: String?
        var dns: String?
        var endpoint: String?
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
            default: break
            }
        }
        guard let priv, let pub else { return nil }
        privateKey = priv
        peerPublicKey = pub
        address = addr
        self.dns = dns
        // Strip ":port" from an IPv4 endpoint (our gateways are IPv4 literals).
        if let endpoint, let colon = endpoint.lastIndex(of: ":") {
            endpointHost = String(endpoint[..<colon])
        } else {
            endpointHost = endpoint
        }
    }
}
