//! CumulusVPN desktop — Tauri application core.
//!
//! Wires the tray window, the plugins (shell for the wireguard-go sidecar,
//! opener for the payment page), the managed [`TunnelManager`] state, and the
//! `connect` / `disconnect` / `status` commands.

mod commands;
mod tunnel;

use tunnel::TunnelManager;

/// Build and run the Tauri application. Called from `main.rs` (and reusable by
/// integration harnesses / a future daemon front-end).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(TunnelManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::connect_multihop,
            commands::disconnect,
            commands::status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the CumulusVPN tauri application");
}
