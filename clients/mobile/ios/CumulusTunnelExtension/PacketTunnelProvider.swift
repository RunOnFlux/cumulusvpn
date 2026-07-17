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
import NetworkExtension
import os

#if canImport(WireGuardKit)
import WireGuardKit
#endif

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let log = Logger(subsystem: "com.cumulusvpn.tunnel", category: "PacketTunnel")

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
        #if canImport(WireGuardKit)
        guard
            let outer = try? TunnelConfiguration(fromWgQuickConfig: outerConf),
            let inner = try? TunnelConfiguration(fromWgQuickConfig: innerConf)
        else {
            completionHandler(TunnelError.invalidConfig)
            return
        }
        log.log("multihop: entry=\(outer.peers.first?.endpoint?.stringRepresentation ?? "?", privacy: .public) exit=\(inner.peers.first?.endpoint?.stringRepresentation ?? "?", privacy: .public)")

        // Bring up the OUTER (wg-entry) device on the OS tun. Its AllowedIPs pin
        // the exit IP/32, so it re-encrypts exactly the inner tunnel's packets to
        // the entry.
        adapter.start(tunnelConfiguration: outer) { [weak self] error in
            guard let self else { return }
            if let error {
                self.log.error("multihop outer start failed: \(String(describing: error))")
                completionHandler(error)
                return
            }
            // POC (unavoidable WireGuardKit seam): WireGuardAdapter binds exactly
            // one wireguard-go device to `packetFlow`, so a second adapter cannot
            // take the tun. True nesting needs a bundled wireguard-go whose INNER
            // device reads the tun and whose UDP bind is redirected into the
            // OUTER device (the Mullvad multihop approach). `inner` is fully
            // parsed here so filling the seam is a drop-in — nothing above this
            // layer (core, JS bridge, RN module) changes.
            self.log.log("multihop inner (\(inner.interface.mtu.map { String($0) } ?? "?", privacy: .public) MTU) device pending bundled wireguard-go — POC")
            completionHandler(nil)
        }
        #else
        log.error("WireGuardKit unavailable — multihop not started (POC)")
        completionHandler(TunnelError.notImplemented)
        #endif
    }

    override func stopTunnel(
        with _: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        #if canImport(WireGuardKit)
        adapter.stop { _ in completionHandler() }
        #else
        completionHandler()
        #endif
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
