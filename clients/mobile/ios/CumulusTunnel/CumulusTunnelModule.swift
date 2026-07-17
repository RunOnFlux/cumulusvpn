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

import Foundation
import NetworkExtension
import React

@objc(CumulusTunnel)
final class CumulusTunnelModule: RCTEventEmitter {
    private let tunnelBundleId = "com.cumulusvpn.app.PacketTunnel"
    private var manager: NETunnelProviderManager?

    override static func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String]! { ["CumulusTunnelStatus"] }

    // startTunnel(wgConfig, serverName): Promise<void>
    @objc(startTunnel:serverName:resolver:rejecter:)
    func startTunnel(
        _ wgConfig: String,
        serverName: String,
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
            resolve: resolve,
            reject: reject
        )
    }

    // startMultihop(outerConfig, innerConfig, routeLabel): Promise<void>
    // Opt-in nested-onion route (docs/11). The extension runs two stacked
    // WireGuard interfaces sharing the same key K; here we just hand both
    // rendered configs to the PacketTunnelProvider.
    @objc(startMultihop:innerConfig:routeLabel:resolver:rejecter:)
    func startMultihop(
        _ outerConfig: String,
        innerConfig: String,
        routeLabel: String,
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
            resolve: resolve,
            reject: reject
        )
    }

    // Shared save-manager + start-tunnel flow for single- and multi-hop.
    private func startWithProviderConfig(
        _ providerConfiguration: [String: NSObject],
        label: String,
        serverAddress: String,
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
            mgr.protocolConfiguration = proto
            mgr.localizedDescription = label
            mgr.isEnabled = true
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
        manager?.connection.stopVPNTunnel()
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
