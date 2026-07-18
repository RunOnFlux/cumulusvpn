// PacketTunnelProvider.swift
//
// iOS Network Extension that runs the WireGuard data plane, driven by
// WireGuardKit (the official wireguard-apple package, added via Swift Package
// Manager — see the project's Package dependencies and the
// PacketTunnelExtension target's "Frameworks and Libraries"). This file lives in
// a SEPARATE app-extension target ("PacketTunnelExtension") from the RN app; the
// extension carries the `com.apple.developer.networking.networkextension`
// entitlement with the `packet-tunnel-provider` value.
//
// STORE / ENTITLEMENT NOTES (docs/05):
//  - Apple 5.4 requires an *organization* Apple Developer account for VPN apps.
//  - VPN must use the NEVPNManager / NetworkExtension APIs — WireGuardKit does.
//  - wireguard-apple pulls in a Go-built `wireguard-go` xcframework; SPM builds
//    it for the device + simulator slices on first resolve.
//
// The provider is fed a rendered wg-quick config through
// `NETunnelProviderProtocol.providerConfiguration`:
//   - single-hop:  { "wgConfig": <conf> }
//   - multi-hop:   { "mode": "multihop", "outerConfig": <conf>, "innerConfig": <conf> }

import Foundation
import Network
import NetworkExtension
import os

#if canImport(WireGuardKit)
import WireGuardKit
#endif

// Wgnest.xcframework — the gomobile-built nested-tunnel core (two stacked
// wireguard-go devices behind one tun). Built by clients/native/wgnest/build-ios.sh.
#if canImport(Wgnest)
import Wgnest
#endif

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let log = Logger(subsystem: "com.cumulusvpn.tunnel", category: "PacketTunnel")

    // Non-zero while a nested (multi-hop) tunnel is running via wgnest; the
    // handle returned by WgmobileStart, passed to WgmobileStop on teardown.
    private var nestHandle: Int64 = 0

    #if canImport(WireGuardKit)
    // The OUTER adapter owns the OS tun (packetFlow). For single-hop it carries
    // all traffic; for multi-hop it is the wg-entry device (see startMultihop).
    private lazy var adapter: WireGuardAdapter = {
        WireGuardAdapter(with: self) { [weak self] _, message in
            self?.log.log("wg-outer: \(message, privacy: .public)")
        }
    }()
    #endif

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
        guard let wgQuickConfig = providerConfigValue(forKey: "wgConfig") else {
            completionHandler(TunnelError.missingConfig)
            return
        }
        #if canImport(WireGuardKit)
        guard let config = try? TunnelConfiguration(fromWgQuickConfig: wgQuickConfig) else {
            completionHandler(TunnelError.invalidConfig)
            return
        }
        adapter.start(tunnelConfiguration: config) { error in
            if let error { self.log.error("adapter.start failed: \(String(describing: error))") }
            completionHandler(error)
        }
        #else
        log.error("WireGuardKit unavailable — tunnel not started (POC)")
        completionHandler(TunnelError.notImplemented)
        #endif
    }

    // MARK: - multi-hop (nested onion, docs/11)

    // Two stacked WireGuard interfaces sharing the same client key K:
    //
    //   OS tun (0.0.0.0/0, MTU 1340)
    //     → INNER device (peer = EXIT)  encrypts to EXIT → UDP to <exitIp>:51820
    //     → OUTER device (peer = ENTRY, AllowedIPs = <exitIp>/32) encrypts to ENTRY
    //     → real UDP socket → ENTRY:51820
    //
    // The ENTRY operator only ever forwards a premium peer's ciphertext to
    // another gateway's :51820 — it never sees the real destination. No gateway
    // protocol change (docs/11).
    private func startMultihop(completionHandler: @escaping (Error?) -> Void) {
        guard
            let outerConf = providerConfigValue(forKey: "outerConfig"),
            let innerConf = providerConfigValue(forKey: "innerConfig")
        else {
            completionHandler(TunnelError.missingConfig)
            return
        }
        #if canImport(WireGuardKit) && canImport(Wgnest)
        guard
            let outer = try? TunnelConfiguration(fromWgQuickConfig: outerConf),
            let inner = try? TunnelConfiguration(fromWgQuickConfig: innerConf),
            let entryPeer = outer.peers.first,
            let exitPeer = inner.peers.first,
            let entryIp = hostString(entryPeer.endpoint),
            let exitIp = hostString(exitPeer.endpoint),
            let entryAssigned = outer.interface.addresses.first.map({ "\($0.address)" }),
            let exitAssigned = inner.interface.addresses.first.map({ "\($0.address)" })
        else {
            completionHandler(TunnelError.invalidConfig)
            return
        }
        let clientPriv = outer.interface.privateKey.base64Key
        let entryPub = entryPeer.publicKey.base64Key
        let exitPub = exitPeer.publicKey.base64Key
        let exitDns = inner.interface.dns.first.map { "\($0.address)" } ?? "1.1.1.1"
        log.log("multihop: entry=\(entryIp, privacy: .public) exit=\(exitIp, privacy: .public)")

        // Build the tun the same way the OS tun carries app traffic: exit-assigned
        // address, exit DNS, MTU 1340 (room for two stacked WireGuard headers).
        // Route everything into the tun EXCEPT the entry IP — so the outer
        // device's one real socket to the entry bypasses the VPN (no loop). iOS
        // gives us excludedRoutes natively (Android had to synthesise it).
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
            // The tun now exists; find its fd (same scan WireGuardKit uses) and
            // hand it to the wgnest core as the inner device's tun.
            guard let fd = self.tunnelFileDescriptor else {
                self.log.error("multihop: could not locate tun fd")
                completionHandler(TunnelError.invalidConfig)
                return
            }
            var handle: Int64 = 0
            var startErr: NSError?
            let ok = WgmobileStart(
                clientPriv, entryPub, entryIp, entryAssigned,
                exitPub, exitIp, exitAssigned,
                Int(fd), &handle, &startErr
            )
            if !ok || startErr != nil {
                self.log.error("multihop WgmobileStart failed: \(String(describing: startErr))")
                completionHandler(startErr ?? TunnelError.notImplemented)
                return
            }
            self.nestHandle = handle
            self.log.log("nested tunnel up: entry=\(entryIp, privacy: .public) exit=\(exitIp, privacy: .public) handle=\(handle)")
            completionHandler(nil)
        }
        #else
        log.error("WireGuardKit/Wgnest unavailable — multihop not started (POC)")
        completionHandler(TunnelError.notImplemented)
        #endif
    }

    override func stopTunnel(
        with _: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        #if canImport(Wgnest)
        if nestHandle != 0 {
            WgmobileStop(nestHandle)
            nestHandle = 0
            completionHandler()
            return
        }
        #endif
        #if canImport(WireGuardKit)
        adapter.stop { _ in completionHandler() }
        #else
        completionHandler()
        #endif
    }

    // MARK: - helpers

    /// The bare host string of a WireGuard endpoint (our gateways are always an
    /// IPv4 literal, but handle the other cases for completeness).
    private func hostString(_ endpoint: Endpoint?) -> String? {
        guard let host = endpoint?.host else { return nil }
        switch host {
        case let .ipv4(addr): return "\(addr)"
        case let .ipv6(addr): return "\(addr)"
        case let .name(name, _): return name
        @unknown default: return nil
        }
    }

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

    // Handle app→extension messages (e.g. a status request forwarded from JS).
    override func handleAppMessage(
        _: Data,
        completionHandler: ((Data?) -> Void)?
    ) {
        #if canImport(WireGuardKit)
        adapter.getRuntimeConfiguration { settings in
            completionHandler?(settings?.data(using: .utf8))
        }
        #else
        completionHandler?(nil)
        #endif
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
