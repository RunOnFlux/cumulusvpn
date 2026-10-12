// CumulusIdentityModule.swift
//
// Keeps a copy of the device identity in the iPhone Keychain, so deleting and
// reinstalling the app brings the same identity (and the premium paid for it)
// back. The app's own storage is wiped on delete; Keychain items are not.
//
// Deliberately NOT synced through iCloud Keychain: that would put the same
// WireGuard key on every device signed into the Apple ID at once (an iPad and an
// iPhone), and two devices on one key fight over the same tunnel. The item is
// `AfterFirstUnlock` rather than `ThisDeviceOnly`, so an encrypted backup or a
// direct transfer to a new iPhone can carry it; the in-app recovery key is the
// guaranteed way across devices.
//
// The item lives in the app group's keychain access group, not the default one.
// The default group is `<App ID prefix>.com.cumulusvpn.app`, and an App Store
// transfer to another developer team changes that prefix to the new Team ID: the
// first build signed by the new team can no longer see items in the old group.
// An app group's access group carries no prefix, so it survives the transfer.
// Builds before this one wrote to the default group; `load` moves such an item
// into the app group the first time it finds one.
//
// What is stored is the recovery-key string (checksummed), never interpreted
// here. Method names + promise shapes match `src/native/CumulusIdentity.ts`.

import Foundation
import React
import Security

@objc(CumulusIdentity)
final class CumulusIdentityModule: NSObject {
    private static let service = "com.cumulusvpn.identity"
    private static let account = "device-key.v1"
    // Must match `com.apple.security.application-groups` in CumulusVPN.entitlements.
    private static let accessGroup = "group.com.cumulusvpn.app"

    @objc static func requiresMainQueueSetup() -> Bool { false }

    // Matches the item in every access group the app can reach — the app
    // group's copy and a pre-migration copy in the default group alike.
    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    // Matches only the app group's copy.
    private var groupQuery: [String: Any] {
        var q = query
        q[kSecAttrAccessGroup as String] = Self.accessGroup
        return q
    }

    private enum Read {
        // value is nil when the item exists but doesn't decode.
        case found(value: String?, group: String?)
        case notFound
        case failed(OSStatus)
    }

    private func read(_ base: [String: Any]) -> Read {
        var find = base
        find[kSecReturnData as String] = true
        find[kSecReturnAttributes as String] = true
        find[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(find as CFDictionary, &out)
        switch status {
        case errSecSuccess:
            let item = out as? [String: Any]
            let value = (item?[kSecValueData as String] as? Data).flatMap { String(data: $0, encoding: .utf8) }
            return .found(value: value, group: item?[kSecAttrAccessGroup as String] as? String)
        case errSecItemNotFound:
            return .notFound
        default:
            return .failed(status)
        }
    }

    // What `load` resolves with: the stored string, or null for nothing usable.
    private static func loaded(_ value: String?) -> [String: Any] {
        ["status": "ok", "value": value.map { $0 as Any } ?? NSNull()]
    }

    private func add(_ secret: String, to base: [String: Any]) -> OSStatus {
        var add = base
        add[kSecValueData as String] = Data(secret.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil)
    }

    // Copy a pre-migration item into the app group, confirm the copy reads back,
    // then delete the original. Any failure leaves the original where it was, so
    // the next launch tries again; nothing is ever deleted without a good copy.
    private func moveToGroup(_ secret: String, from legacyGroup: String?) {
        let status = add(secret, to: groupQuery)
        guard status == errSecSuccess || status == errSecDuplicateItem else { return }
        guard case .found(let copy, _) = read(groupQuery), copy == secret else { return }
        guard let legacyGroup, legacyGroup != Self.accessGroup else { return }
        var original = query
        original[kSecAttrAccessGroup as String] = legacyGroup
        SecItemDelete(original as CFDictionary)
    }

    // save(secret): Promise<'device'>
    @objc(save:resolver:rejecter:)
    func save(
        _ secret: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Clears every copy, including a pre-migration one in the default group.
        SecItemDelete(query as CFDictionary)
        var status = add(secret, to: groupQuery)
        if status == errSecMissingEntitlement {
            // A build without the app group entitlement: fall back to the default
            // group rather than lose the backup altogether.
            status = add(secret, to: query)
        }
        if status == errSecSuccess {
            resolve("device")
        } else {
            reject("E_BACKUP", "Keychain write failed (\(status))", nil)
        }
    }

    // load(): Promise<{status:'ok', value: string|null}>. Rejects when the
    // Keychain can't answer (e.g. before first unlock), so the caller can tell
    // "empty" from "unknown" and never overwrites a copy it failed to read.
    @objc(load:rejecter:)
    func load(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        switch read(groupQuery) {
        case .found(let value, _):
            resolve(Self.loaded(value))
            return
        case .failed(let status) where status != errSecMissingEntitlement:
            reject("E_BACKUP", "Keychain read failed (\(status))", nil)
            return
        case .notFound, .failed:
            break
        }

        // Nothing in the app group: look for a copy written by an earlier build.
        switch read(query) {
        case .found(let value, let group):
            if let value {
                moveToGroup(value, from: group)
            }
            resolve(Self.loaded(value))
        case .notFound:
            resolve(Self.loaded(nil))
        case .failed(let status):
            reject("E_BACKUP", "Keychain read failed (\(status))", nil)
        }
    }

    // remove(): Promise<boolean>
    @objc(remove:rejecter:)
    func remove(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // No access group in the query: removes the app group's copy and any
        // pre-migration copy alike.
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            resolve(status == errSecSuccess)
        } else {
            reject("E_BACKUP", "Keychain delete failed (\(status))", nil)
        }
    }
}
