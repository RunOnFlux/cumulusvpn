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
// What is stored is the recovery-key string (checksummed), never interpreted
// here. Method names + promise shapes match `src/native/CumulusIdentity.ts`.

import Foundation
import React
import Security

@objc(CumulusIdentity)
final class CumulusIdentityModule: NSObject {
    private static let service = "com.cumulusvpn.identity"
    private static let account = "device-key.v1"

    @objc static func requiresMainQueueSetup() -> Bool { false }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    // save(secret): Promise<'device'>
    @objc(save:resolver:rejecter:)
    func save(
        _ secret: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = Data(secret.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(add as CFDictionary, nil)
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
        var find = query
        find[kSecReturnData as String] = true
        find[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(find as CFDictionary, &out)
        switch status {
        case errSecSuccess:
            guard let data = out as? Data, let value = String(data: data, encoding: .utf8) else {
                resolve(["status": "ok", "value": NSNull()])
                return
            }
            resolve(["status": "ok", "value": value])
        case errSecItemNotFound:
            resolve(["status": "ok", "value": NSNull()])
        default:
            reject("E_BACKUP", "Keychain read failed (\(status))", nil)
        }
    }

    // remove(): Promise<boolean>
    @objc(remove:rejecter:)
    func remove(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            resolve(status == errSecSuccess)
        } else {
            reject("E_BACKUP", "Keychain delete failed (\(status))", nil)
        }
    }
}
