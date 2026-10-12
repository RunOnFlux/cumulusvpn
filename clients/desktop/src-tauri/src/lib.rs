//! CumulusVPN desktop — Tauri application core.
//!
//! Wires the tray, the plugins (shell for the wireguard-go sidecar, opener for
//! the payment page), the managed [`TunnelBackend`] state, and the `connect` /
//! `disconnect` / `status` commands.
//!
//! **Where the tunnel runs depends on the OS** (see [`backend`]):
//!
//! * **macOS**: this process has no privileges. The tunnel, the routing table
//!   and the kill switch belong to the `cumulusvpn-helper` daemon, and
//!   everything here goes over a socket to it. That is what removes the `sudo`
//!   requirement: the user approves the helper once, in System Settings. Roam
//!   repair and the dead-tunnel watchdog run in the daemon's own loop, so the
//!   tunnel recovers even with the app quit.
//! * **Linux and Windows**: the tunnel runs in this process, which must be
//!   elevated, as it always has. Roam repair and the watchdog run on a thread
//!   here, so they keep working while the window is hidden in the tray, but
//!   not once the app has quit (quitting disconnects).

mod backend;
mod commands;
#[cfg(target_os = "macos")]
mod helper_client;
#[cfg(target_os = "macos")]
mod helper_install;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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
/// with no UI to clear it strands the user offline. On macOS the helper
/// outlives us and would happily keep the tunnel up, so say so explicitly. On
/// Linux and Windows the tunnel is ours, and this is what lifts the kill switch
/// and removes the routes before the process goes.
///
/// Only when something is up, though: a quit with no tunnel must not touch the
/// firewall (see [`TunnelBackend::disconnect_if_active`]).
///
/// This is best-effort — a SIGKILL runs nothing. On macOS that case is the
/// helper's to handle, and as a daemon it genuinely can: it sees the socket
/// close and can decide for itself (see the H14 gap in docs/16). On Linux and
/// Windows a killed app leaves the kill switch engaged (fail-closed) until the
/// next connect or disconnect.
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
        .manage(TunnelBackend::new())
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::connect_multihop,
            commands::disconnect,
            commands::status,
            commands::helper_status,
            commands::helper_registration,
            commands::open_helper_settings,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if app.state::<TunnelBackend>().uses_helper() {
                register_helper();
            }

            let show = MenuItemBuilder::with_id("show", "Show CumulusVPN").build(app)?;
            let disconnect = MenuItemBuilder::with_id("disconnect", "Disconnect").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit CumulusVPN").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &disconnect, &quit])
                .build()?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("CumulusVPN")
                .menu(&menu)
                // Left click belongs to the window, not the menu — the menu is
                // the right-click affordance users expect from a tray app.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    // Disconnecting from the tray is the whole point of having
                    // one: the window may be hidden when the user wants out.
                    "disconnect" => {
                        let _ = app.state::<TunnelBackend>().disconnect();
                    }
                    // `exit` raises RunEvent::Exit, which tears the tunnel
                    // down — no need to do it twice here.
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Close to tray. A VPN client that quits when you click the red
                // dot is a VPN client that silently drops your tunnel: quitting
                // disconnects (see `shutdown`), and on Linux/Windows the tunnel
                // and its repair loop live in this process. Quit is an explicit
                // tray action.
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
