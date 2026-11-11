//! CumulusVPN desktop — Tauri application core.
//!
//! Wires the tray, the plugins (shell for the wireguard-go sidecar, opener for
//! the payment page), the managed [`TunnelBackend`] state, and the `connect` /
//! `disconnect` / `status` commands.
//!
//! **Where the tunnel runs** (see [`backend`]): normally in the privileged
//! `cumulusvpn-helper` daemon, and this process has no privileges at all — on
//! macOS a LaunchDaemon the user approves once in System Settings, on Linux a
//! systemd service and on Windows a LocalSystem service, both installed by the
//! packages. Everything here goes over local IPC to it. Roam repair and the
//! dead-tunnel watchdog run in the daemon's own loop, so the tunnel recovers
//! even with the app quit or killed.
//!
//! The exception is an elevated app with no daemon to talk to (macOS run as
//! root; a Linux AppImage or a Windows build without its service, run as root /
//! Administrator): the tunnel then runs in this process, as it did before the
//! daemon existed, with the same repair loop on a thread here.

mod backend;
mod commands;
mod helper_client;
#[cfg(target_os = "macos")]
mod helper_install;
#[cfg(not(target_os = "macos"))]
mod platform;
mod tray;

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

use backend::TunnelBackend;

/// Bring the main window back to the front, recreating nothing — the window is
/// hidden on close, never destroyed, so it always exists.
fn show_main_window(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Tear the tunnel down on the way out.
///
/// Quitting the app is not the same as wanting your traffic unprotected, but it
/// is the same as wanting your machine usable: leaving the kill switch engaged
/// with no UI to clear it strands the user offline. The helper daemon outlives
/// us and would happily keep the tunnel up, so say so explicitly. In the
/// in-process fallback the tunnel is ours, and this is what lifts the kill
/// switch and removes the routes before the process goes.
///
/// Only when something is up, though: a quit with no tunnel must not touch the
/// firewall (see [`TunnelBackend::disconnect_if_active`]).
///
/// This is best-effort — a SIGKILL or `taskkill /F` runs nothing. With the
/// helper that is fine by design: the daemon keeps the tunnel and its repair
/// loop running, and the relaunched app reattaches to the live session (rows
/// H14 / H14L in docs/16). Only the in-process fallback strands the kill switch
/// (fail-closed) until the app is relaunched, whose startup recovery lifts it.
fn shutdown(handle: &AppHandle) {
    handle.state::<TunnelBackend>().disconnect_if_active();
}

/// Register the privileged helper (macOS only, and only when this launch
/// actually uses it — not when running as root).
///
/// macOS shows this to the user as an approval in Settings rather than a
/// password prompt, so it is safe to ask for at launch.
#[cfg(target_os = "macos")]
fn register_helper() {
    match helper_install::ensure_registered() {
        Ok(helper_install::HelperState::NotFound) => eprintln!(
            "CumulusVPN: macOS will not vouch for the bundled helper. \
             The usual cause is an unsigned or ad-hoc signed build — \
             SMAppService validates the daemon against the app's \
             signature. See clients/desktop/scripts/sign-macos.sh. \
             To run an unsigned build anyway, launch it as root \
             (sudo), which uses the in-process tunnel instead."
        ),
        Ok(_) => {}
        Err(e) => eprintln!("CumulusVPN: helper registration: {e}"),
    }
}

/// Build and run the Tauri application. Called from `main.rs` (and reusable by
/// integration harnesses / a future daemon front-end).
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        // The fleet's HTTP goes through Rust: no CORS/ATS (src/lib/nativeFetch.ts).
        .plugin(tauri_plugin_http::init())
        // Connect / drop / reconnect notifications (Settings → Notifications).
        .plugin(tauri_plugin_notification::init())
        .manage(TunnelBackend::new())
        .manage(tray::TrayUi::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::connect_multihop,
            commands::disconnect,
            commands::status,
            commands::helper_status,
            commands::helper_registration,
            commands::open_helper_settings,
            tray::set_tray,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if app.state::<TunnelBackend>().uses_helper() {
                register_helper();
            }

            tray::install(app, show_main_window)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Close to tray. A VPN client that quits when you click the red
                // dot is a VPN client that silently drops your tunnel: quitting
                // disconnects (see `shutdown`), and in the in-process fallback
                // the tunnel and its repair loop live in this process. Quit is
                // an explicit tray action.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running the CumulusVPN tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            shutdown(handle);
        }
    });
}
