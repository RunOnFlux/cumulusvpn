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
    // Token for the single NEVPNStatusDidChange observer — removed before it is
    // re-added, so repeated connects don't accumulate duplicate observers (which
    // would fire N duplicate status events and retain the connection).
    private var statusObserver: NSObjectProtocol?

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
        // ensureManager (not `manager`) so a tunnel started before an app relaunch
        // can still be torn down — otherwise stop silently no-ops and, with the
        // kill switch armed, the user has no in-app way to disconnect.
        ensureManager { mgr in
            guard let mgr else {
                resolve(nil)
                return
            }
            guard mgr.isOnDemandEnabled else {
                mgr.connection.stopVPNTunnel()
                resolve(nil)
                return
            }
            // Kill switch on: disable on-demand + SAVE before tearing down, else
            // iOS re-dials the moment we stop. If the save fails, on-demand is
            // still armed — surface it rather than pretend we disconnected.
            mgr.isOnDemandEnabled = false
            mgr.onDemandRules = []
            mgr.saveToPreferences { err in
                if let err {
                    reject("E_STOP", "Could not disable always-on: \(err.localizedDescription)", err)
                    return
                }
                mgr.connection.stopVPNTunnel()
                resolve(nil)
            }
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
    // Live byte counters + last handshake live in the tunnel extension (wgnest).
    // Ask it via an app message — handleAppMessage returns WgmobileGetStats as the
    // CSV "rxBytes,txBytes,lastHandshakeSec". Only meaningful while connected;
    // otherwise resolve zeros immediately (no extension to answer).
    @objc(getStatus:rejecter:)
    func getStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // ensureManager so a tunnel that came up before this app launch is
        // reported as connected (and its status events start flowing), instead of
        // showing "disconnected" over a live tunnel.
        ensureManager { mgr in
            let conn = mgr?.connection
            let state = conn?.status ?? .invalid
            guard state == .connected, let session = conn as? NETunnelProviderSession else {
                resolve(Self.statusPayload(from: state))
                return
            }
            do {
                try session.sendProviderMessage(Data([0x01])) { reply in
                    var rx: Int64 = 0
                    var tx: Int64 = 0
                    var hs: Int64 = 0
                    if let reply, let csv = String(data: reply, encoding: .utf8) {
                        let p = csv.split(separator: ",")
                        if p.count == 3 {
                            rx = Int64(p[0]) ?? 0
                            tx = Int64(p[1]) ?? 0
                            hs = Int64(p[2]) ?? 0
                        }
                    }
                    resolve(Self.statusPayload(from: .connected, rx: rx, tx: tx, handshake: hs))
                }
            } catch {
                resolve(Self.statusPayload(from: state))
            }
        }
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
        // configurations" system prompt. A manager with NO protocol
        // configuration fails validation (NEVPNErrorConfigurationInvalid) before
        // the prompt even shows — which surfaced to the user as
        // "VPN permission is required to connect." Give it a minimal valid
        // provider protocol so the save is accepted and the prompt appears; the
        // real connect overwrites it with the full tunnel config.
        loadOrCreateManager { [weak self] mgr, _ in
            guard let self, let mgr else { resolve(false); return }
            if mgr.protocolConfiguration == nil {
                let proto = NETunnelProviderProtocol()
                proto.providerBundleIdentifier = self.tunnelBundleId
                proto.serverAddress = "CumulusVPN"
                mgr.protocolConfiguration = proto
            }
            mgr.localizedDescription = "CumulusVPN"
            mgr.isEnabled = true
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

    /// The cached tunnel manager, loading it from saved preferences if we don't
    /// have one yet — e.g. after the app is killed and relaunched while the tunnel
    /// is still up. Attaches the status observer to a manager we didn't start this
    /// launch so events flow and stop works. `nil` = no VPN configuration exists.
    /// Unlike loadOrCreateManager, this never fabricates an empty manager.
    private func ensureManager(_ completion: @escaping (NETunnelProviderManager?) -> Void) {
        if let mgr = manager {
            completion(mgr)
            return
        }
        NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, _ in
            guard let self else {
                completion(nil)
                return
            }
            self.manager = managers?.first
            if let conn = self.manager?.connection {
                self.observe(conn)
            }
            completion(self.manager)
        }
    }

    private func observe(_ connection: NEVPNConnection) {
        if let existing = statusObserver {
            NotificationCenter.default.removeObserver(existing)
        }
        statusObserver = NotificationCenter.default.addObserver(
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

    private static func statusPayload(
        from status: NEVPNStatus,
        rx: Int64 = 0,
        tx: Int64 = 0,
        handshake: Int64 = 0
    ) -> [String: Any] {
        let state: String
        switch status {
        case .connected: state = "connected"
        case .connecting: state = "connecting"
        case .reasserting: state = "reasserting"
        case .disconnecting: state = "disconnecting"
        case .disconnected, .invalid: state = "disconnected"
        @unknown default: state = "disconnected"
        }
        // rx/tx/handshake come from the extension (WgmobileGetStats) via getStatus;
        // status-change events carry zeros (the poll fills in live counters).
        return ["state": state, "rxBytes": rx, "txBytes": tx, "lastHandshake": handshake]
    }
}
