//! The device identity's copy in the OS credential store — macOS Keychain,
//! Windows Credential Manager, or the Secret Service on Linux.
//!
//! The identity is the WireGuard keypair, and Premium is paid to it. The app
//! keeps it in the webview's `localStorage`, which a reinstall, a "reset app
//! data" or a cleaner can wipe; the credential store outlives all of those.
//! This is the desktop counterpart of mobile's Keychain / Block Store backup
//! (`clients/mobile/src/state/identity.ts`).
//!
//! This module only reads and writes one opaque string. Every decision —
//! restore, back up, and NEVER silently overwrite a different identity —
//! is made in `src/lib/identityBackup.ts`, where it is unit-tested.

const SERVICE: &str = "com.cumulusvpn.desktop";
const ACCOUNT: &str = "identity.v1";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("credential store: {e}"))
}

/// The stored identity blob; `None` when there is none. An `Err` means the
/// store could not be READ — callers must then not write either, since a
/// different identity may be sitting behind the failure.
#[tauri::command]
pub fn identity_backup_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("credential store: {e}")),
    }
}

#[tauri::command]
pub fn identity_backup_set(value: String) -> Result<(), String> {
    entry()?
        .set_password(&value)
        .map_err(|e| format!("credential store: {e}"))
}
