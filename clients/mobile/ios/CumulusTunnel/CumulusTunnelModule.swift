// CumulusTunnelModule.swift
//
// The React Native <-> iOS bridge (main app target). It does NOT run the
// tunnel itself — the packet processing lives in the PacketTunnelProvider
// extension. This module installs/starts/stops the tunnel via
// NETunnelProviderManager and streams status back to JS.
//
// Method names + promise/event shapes match `src/native/CumulusTunnel.ts`.
// POC: bodies are scaffolded with the real NetworkExtension calls; the manager
// save/load flow is outlined but not exhaustively error-handled.

import CryptoKit
import Foundation
import NetworkExtension
import React

@objc(CumulusTunnel)
final class CumulusTunnelModule: RCTEventEmitter {
    private let tunnelBundleId = "com.cumulusvpn.app.PacketTunnel"
    private var manager: NETunnelProviderManager?

    override static func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String]! { ["CumulusTunnelStatus"] }

    // startTunnel(wgConfig, serverName, killSwitch): Promise<void>
    @objc(startTunnel:serverName:killSwitch:resolver:rejecter:)
    func startTunnel(
        _ wgConfig: String,
        serverName: String,
        killSwitch: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // POC: the rendered wg-quick config is passed to the extension via
        // providerConfiguration. For a production build the private key belongs
        // in the Keychain and only a reference is passed here.
        startWithProviderConfig(
            ["mode": "single" as NSString, "wgConfig": wgConfig as NSString],
            label: "CumulusVPN — \(serverName)",
            serverAddress: serverName,
            killSwitch: killSwitch,
            resolve: resolve,
            reject: reject
        )
    }

    // startMultihop(outerConfig, innerConfig, routeLabel): Promise<void>
    // Opt-in nested-onion route (docs/11). The extension runs two stacked
    // WireGuard interfaces sharing the same key K; here we just hand both
    // rendered configs to the PacketTunnelProvider.
    @objc(startMultihop:innerConfig:routeLabel:killSwitch:resolver:rejecter:)
    func startMultihop(
        _ outerConfig: String,
        innerConfig: String,
        routeLabel: String,
        killSwitch: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        startWithProviderConfig(
            [
                "mode": "multihop" as NSString,
                "outerConfig": outerConfig as NSString,
                "innerConfig": innerConfig as NSString,
            ],
            label: "CumulusVPN — \(routeLabel)",
            serverAddress: routeLabel,
            killSwitch: killSwitch,
            resolve: resolve,
            reject: reject
        )
    }

    // Shared save-manager + start-tunnel flow for single- and multi-hop.
    private func startWithProviderConfig(
        _ providerConfiguration: [String: NSObject],
        label: String,
        serverAddress: String,
        killSwitch: Bool,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        loadOrCreateManager { [weak self] mgr, error in
            guard let self, let mgr else {
                reject("E_MANAGER", "Failed to load tunnel manager", error)
                return
            }
            let proto = NETunnelProviderProtocol()
            proto.providerBundleIdentifier = self.tunnelBundleId
            // iOS requires a non-empty server address for the OS VPN UI.
            proto.serverAddress = serverAddress
            proto.providerConfiguration = providerConfiguration
            // Kill switch: route every network through the tunnel (no leaks),
            // excluding local networks so LAN/AirDrop still work.
            proto.includeAllNetworks = killSwitch
            proto.excludeLocalNetworks = killSwitch
            mgr.protocolConfiguration = proto
            mgr.localizedDescription = label
            mgr.isEnabled = true
            // Kill switch: on-demand keeps the VPN mandatory — if it drops, iOS
            // blocks matching traffic until it reconnects. A single connect rule
            // matching any interface makes it an always-on block.
            if killSwitch {
                let rule = NEOnDemandRuleConnect()
                rule.interfaceTypeMatch = .any
                mgr.onDemandRules = [rule]
                mgr.isOnDemandEnabled = true
            } else {
                mgr.onDemandRules = []
                mgr.isOnDemandEnabled = false
            }
            mgr.saveToPreferences { saveErr in
                if let saveErr { reject("E_SAVE", saveErr.localizedDescription, saveErr); return }
                mgr.loadFromPreferences { _ in
                    do {
                        try mgr.connection.startVPNTunnel()
                        self.observe(mgr.connection)
                        resolve(nil)
                    } catch {
                        reject("E_START", error.localizedDescription, error)
                    }
                }
            }
        }
    }

    // stopTunnel(): Promise<void>
    @objc(stopTunnel:rejecter:)
    func stopTunnel(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let mgr = manager else { resolve(nil); return }
        // If the kill switch (on-demand) is on, iOS re-dials the tunnel the moment
        // we stop it — so disable on-demand and save before tearing down.
        if mgr.isOnDemandEnabled {
            mgr.isOnDemandEnabled = false
            mgr.onDemandRules = []
            mgr.saveToPreferences { _ in
                mgr.connection.stopVPNTunnel()
                resolve(nil)
            }
        } else {
            mgr.connection.stopVPNTunnel()
            resolve(nil)
        }
    }

    // openVpnSettings(): Promise<void>
    // On iOS the kill switch is entirely in-app (on-demand + includeAllNetworks),
    // so there is no system lockdown toggle to send the user to — resolve as a
    // no-op. (Android navigates to the OS VPN settings.)
    @objc(openVpnSettings:rejecter:)
    func openVpnSettings(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(nil)
    }

    // getStatus(): Promise<TunnelStatus>
    @objc(getStatus:rejecter:)
    func getStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let state = manager?.connection.status ?? .invalid
        resolve(Self.statusPayload(from: state))
    }

    // isPrepared(): Promise<Bool>
    @objc(isPrepared:rejecter:)
    func isPrepared(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        NETunnelProviderManager.loadAllFromPreferences { managers, _ in
            resolve((managers?.isEmpty == false))
        }
    }

    // requestPermission(): Promise<Bool>
    @objc(requestPermission:rejecter:)
    func requestPermission(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Saving a manager triggers the iOS "… would like to add VPN
        // configurations" system prompt.
        loadOrCreateManager { mgr, error in
            guard let mgr else { resolve(false); return }
            mgr.saveToPreferences { err in resolve(err == nil) }
        }
    }

    // solvePow(publicKeyB64, bits): Promise<String>
    // Solve the enroll anti-flood proof-of-work natively: find a decimal-string
    // nonce such that sha256(pubkey||nonce) has `bits` leading zero bits. Runs on
    // a background queue; CryptoKit SHA-256 clears the 20-bit difficulty in well
    // under a second (the pure-JS Hermes solver takes seconds and freezes the UI).
    // Mirrors core `solvePoW`/`hasLeadingZeroBits`.
    @objc(solvePow:bits:resolver:rejecter:)
    func solvePow(
        _ publicKeyB64: String,
        bits: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let n = bits.intValue
        DispatchQueue.global(qos: .userInitiated).async {
            resolve(Self.solvePowSync(publicKeyB64, bits: n))
        }
    }

    private static func solvePowSync(_ publicKeyB64: String, bits: Int) -> String {
        let pub = Array(publicKeyB64.utf8)
        // Random start so repeated solves for the same key yield DIFFERENT valid
        // nonces (the gateway single-uses each (pubkey, nonce) pair).
        var i = UInt64.random(in: 0..<0x4000_0000)
        while true {
            let nonce = String(i)
            var buf = pub
            buf.append(contentsOf: nonce.utf8)
            if hasLeadingZeroBits(SHA256.hash(data: buf), bits: bits) {
                return nonce
            }
            i += 1
        }
    }

    /// True if `digest` starts with at least `bits` zero bits (mirrors core).
    private static func hasLeadingZeroBits(_ digest: SHA256.Digest, bits: Int) -> Bool {
        let bytes = Array(digest)
        let full = bits / 8
        for k in 0..<full where bytes[k] != 0 {
            return false
        }
        let rem = bits % 8
        if rem != 0 {
            let mask = UInt8((0xff << (8 - rem)) & 0xff)
            if (bytes[full] & mask) != 0 {
                return false
            }
        }
        return true
    }

    // MARK: - internals

    private func loadOrCreateManager(
        _ completion: @escaping (NETunnelProviderManager?, Error?) -> Void
    ) {
        NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, error in
            let mgr = managers?.first ?? NETunnelProviderManager()
            self?.manager = mgr
            completion(mgr, error)
        }
    }

    private func observe(_ connection: NEVPNConnection) {
        NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: connection,
            queue: .main
        ) { [weak self] _ in
            self?.sendEvent(
                withName: "CumulusTunnelStatus",
                body: Self.statusPayload(from: connection.status)
            )
        }
    }

    private static func statusPayload(from status: NEVPNStatus) -> [String: Any] {
        let state: String
        switch status {
        case .connected: state = "connected"
        case .connecting: state = "connecting"
        case .reasserting: state = "reasserting"
        case .disconnecting: state = "disconnecting"
        case .disconnected, .invalid: state = "disconnected"
        @unknown default: state = "disconnected"
        }
        // POC: rx/tx/handshake counters come from the extension via
        // handleAppMessage(getRuntimeConfiguration) — zeros until wired.
        return ["state": state, "rxBytes": 0, "txBytes": 0, "lastHandshake": 0]
    }
}
