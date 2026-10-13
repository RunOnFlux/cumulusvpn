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
// TWO copies, in two keychain access groups (state/identity.ts decides what goes
// where; this file only stores, reads and deletes):
//  - save/load/remove: the app's DEFAULT access group, `<TeamID>.com.cumulusvpn.app`
//    (the application-identifier). It carries the team ID, so after an App Store
//    transfer the new team's builds cannot read it.
//  - saveShared/loadShared/removeShared: the App Group access group,
//    `group.com.cumulusvpn.app`. App group IDs are used as keychain access groups
//    as-is, without a team prefix, and the group moves to the new team after the
//    transfer, so builds from either team can read this copy.
// Every query names its access group. A query without one matches ANY of the
// app's groups (Apple: "Sharing access to keychain items among a collection of
// apps"), so an unscoped delete would wipe both copies at once.
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
    /// Same App Group as CumulusVPN.entitlements / PacketTunnelExtension.entitlements.
    private static let appGroup = "group.com.cumulusvpn.app"

    private struct KeychainError: Error {
        let status: OSStatus
    }

    @objc static func requiresMainQueueSetup() -> Bool { false }

    private static var base: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    // MARK: - Default access group (team-bound)

    // save(secret): Promise<'device'>
    @objc(save:resolver:rejecter:)
    func save(
        _ secret: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        do {
            for group in try teamGroupsHoldingItem() {
                _ = try delete(group: group)
            }
            // No access group = the app's default one (the first in its list,
            // here the application-identifier: <TeamID>.com.cumulusvpn.app).
            try add(secret, group: nil)
            resolve("device")
        } catch let e as KeychainError {
            reject("E_BACKUP", "Keychain write failed (\(e.status))", nil)
        } catch {
            reject("E_BACKUP", "Keychain write failed", error)
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
        do {
            guard let group = try teamGroupsHoldingItem().first else {
                resolve(["status": "ok", "value": NSNull()])
                return
            }
            resolve(Self.okRead(try read(group: group)))
        } catch let e as KeychainError {
            reject("E_BACKUP", "Keychain read failed (\(e.status))", nil)
        } catch {
            reject("E_BACKUP", "Keychain read failed", error)
        }
    }

    // remove(): Promise<boolean>
    @objc(remove:rejecter:)
    func remove(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        do {
            var removed = false
            for group in try teamGroupsHoldingItem() {
                removed = try delete(group: group) || removed
            }
            resolve(removed)
        } catch let e as KeychainError {
            reject("E_BACKUP", "Keychain delete failed (\(e.status))", nil)
        } catch {
            reject("E_BACKUP", "Keychain delete failed", error)
        }
    }

    // MARK: - App Group access group (survives an App Store transfer)

    // saveShared(secret): Promise<'device' | 'unavailable'>
    @objc(saveShared:resolver:rejecter:)
    func saveShared(
        _ secret: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard Self.hasAppGroup else {
            resolve("unavailable")
            return
        }
        do {
            _ = try delete(group: Self.appGroup)
            try add(secret, group: Self.appGroup)
            resolve("device")
        } catch let e as KeychainError where e.status == errSecMissingEntitlement {
            resolve("unavailable")
        } catch let e as KeychainError {
            reject("E_BACKUP", "Keychain write failed (\(e.status))", nil)
        } catch {
            reject("E_BACKUP", "Keychain write failed", error)
        }
    }

    // loadShared(): Promise<{status:'ok', value} | {status:'unavailable'}>.
    // Rejects when the Keychain can't answer, exactly like load().
    @objc(loadShared:rejecter:)
    func loadShared(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard Self.hasAppGroup else {
            resolve(["status": "unavailable"])
            return
        }
        do {
            resolve(Self.okRead(try read(group: Self.appGroup)))
        } catch let e as KeychainError where e.status == errSecMissingEntitlement {
            // This build isn't signed with the app group: the place doesn't exist.
            resolve(["status": "unavailable"])
        } catch let e as KeychainError {
            reject("E_BACKUP", "Keychain read failed (\(e.status))", nil)
        } catch {
            reject("E_BACKUP", "Keychain read failed", error)
        }
    }

    // removeShared(): Promise<boolean>
    @objc(removeShared:rejecter:)
    func removeShared(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard Self.hasAppGroup else {
            resolve(false)
            return
        }
        do {
            resolve(try delete(group: Self.appGroup))
        } catch let e as KeychainError where e.status == errSecMissingEntitlement {
            resolve(false)
        } catch let e as KeychainError {
            reject("E_BACKUP", "Keychain delete failed (\(e.status))", nil)
        } catch {
            reject("E_BACKUP", "Keychain delete failed", error)
        }
    }

    // MARK: - Keychain helpers

    /// The promise shape of a successful read: `{status:'ok', value: string|null}`.
    private static func okRead(_ value: String?) -> [String: Any] {
        if let value {
            return ["status": "ok", "value": value]
        }
        return ["status": "ok", "value": NSNull()]
    }

    /// True when this build is signed with the app group (nil container = not entitled).
    private static var hasAppGroup: Bool {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil
    }

    /// The access groups other than the App Group that hold our item, as the
    /// keychain reports them. For this app that is the default (team) group.
    private func teamGroupsHoldingItem() throws -> [String] {
        var query = Self.base
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        query[kSecReturnAttributes as String] = true
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecItemNotFound {
            return []
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        let items = out as? [[String: Any]] ?? []
        return items
            .compactMap { $0[kSecAttrAccessGroup as String] as? String }
            .filter { $0 != Self.appGroup }
    }

    private func read(group: String) throws -> String? {
        var query = Self.base
        query[kSecAttrAccessGroup as String] = group
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        guard let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Delete our item in exactly `group`. True when there was one.
    private func delete(group: String) throws -> Bool {
        var query = Self.base
        query[kSecAttrAccessGroup as String] = group
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecItemNotFound {
            return false
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        return true
    }

    /// Add our item to `group` (nil = the app's default access group).
    private func add(_ secret: String, group: String?) throws {
        var query = Self.base
        if let group {
            query[kSecAttrAccessGroup as String] = group
        }
        query[kSecValueData as String] = Data(secret.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }
}
