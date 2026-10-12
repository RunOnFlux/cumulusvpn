//! Tauri command surface exposed to the React frontend.
//!
//! Contract mirrors `src/lib/tauri.ts`: `connect`, `disconnect`, `status`, all
//! returning the `camelCase` `TunnelStatus`. Errors are returned as strings
//! (Tauri serializes `Err(String)` into the JS promise rejection), which the
//! hook surfaces in the error banner.
//!
//! Every one of these goes through [`TunnelBackend`]: to the privileged helper
//! on macOS, to the in-process tunnel on Linux and Windows. The argument shapes
//! are the same on every OS (and unchanged from before the helper existed), so
//! the frontend does not know which one it is driving.

use tauri::State;

use cumulusvpn_protocol as proto;

use crate::backend::{SetupState, TunnelBackend};

/// Fold the two optional route lists from JS into a [`proto::SplitParams`], or
/// `None` when the policy is a noop (both absent/empty) so the tunnel takes the
/// byte-identical fast path (docs/17 validation gate V1).
fn split_params(
    bypass_routes: Option<Vec<String>>,
    tunnel_routes: Option<Vec<String>>,
) -> Option<proto::SplitParams> {
    let bypass_routes = bypass_routes.unwrap_or_default();
    let tunnel_routes = tunnel_routes.unwrap_or_default();
    if bypass_routes.is_empty() && tunnel_routes.is_empty() {
        None
    } else {
        Some(proto::SplitParams {
            bypass_routes,
            tunnel_routes,
        })
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect(
    country: String,
    wg_config: String,
    endpoint: String,
    assigned_ip: String,
    kill_switch: bool,
    // wg-tls transport (optional): the gateway's TLS relay address + SNI. Present
    // → the WG device is bridged over TLS instead of dialing UDP directly. Tauri
    // maps JS `tlsServerAddr`/`tlsSni` onto these.
    tls_server_addr: Option<String>,
    tls_sni: Option<String>,
    // Split tunneling (optional): compiled route lists from core-ts
    // `compileSplitPolicy`. Tauri maps JS `bypassRoutes`/`tunnelRoutes`.
    bypass_routes: Option<Vec<String>>,
    tunnel_routes: Option<Vec<String>>,
    backend: State<'_, TunnelBackend>,
) -> Result<proto::TunnelStatus, String> {
    let tls = tls_server_addr.map(|server_addr| proto::TlsParams {
        server_addr,
        sni: tls_sni.unwrap_or_default(),
    });
    backend.connect(proto::ConnectRequest {
        country,
        wg_config,
        endpoint,
        assigned_ip,
        kill_switch,
        tls,
        split: split_params(bypass_routes, tunnel_routes),
    })
}

/// Bring an opt-in multi-hop tunnel up: two stacked wireguard-go devices sharing
/// the same key `K`. Args are the two nested configs from core-ts
/// `buildMultihopConfig` plus the routing facts; Tauri maps the JS `camelCase`
/// keys (`entryCountry`, `entryEndpoint`, `exitEndpoint`, `innerMtu`,
/// `assignedIp`) onto these `snake_case` parameters.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect_multihop(
    entry_country: String,
    exit_country: String,
    outer: String,
    inner: String,
    entry_endpoint: String,
    exit_endpoint: String,
    inner_mtu: u16,
    assigned_ip: String,
    kill_switch: bool,
    bypass_routes: Option<Vec<String>>,
    tunnel_routes: Option<Vec<String>>,
    backend: State<'_, TunnelBackend>,
) -> Result<proto::TunnelStatus, String> {
    backend.connect_multihop(proto::MultihopRequest {
        entry_country,
        exit_country,
        outer,
        inner,
        entry_endpoint,
        exit_endpoint,
        inner_mtu,
        assigned_ip,
        kill_switch,
        split: split_params(bypass_routes, tunnel_routes),
    })
}

#[tauri::command]
pub async fn disconnect(backend: State<'_, TunnelBackend>) -> Result<proto::TunnelStatus, String> {
    backend.disconnect()
}

#[tauri::command]
pub async fn status(backend: State<'_, TunnelBackend>) -> Result<proto::TunnelStatus, String> {
    backend.status()
}

/// Whether the tunnel engine is answering: the privileged helper on macOS,
/// always `true` where the tunnel runs in-process.
///
/// Surfaced so the UI can say "finish setup" instead of letting the user press
/// Connect and meet a transport error.
#[tauri::command]
pub async fn helper_status(backend: State<'_, TunnelBackend>) -> Result<bool, String> {
    Ok(backend.is_available())
}

/// Setup state, as a string the UI can switch on: `notNeeded` (Linux, Windows,
/// macOS run as root: no helper exists, Connect is usable), `enabled`,
/// `requiresApproval`, `notRegistered`, `notFound`.
///
/// Distinct from [`helper_status`], which asks only whether the daemon
/// *answers*. A helper can be registered but awaiting approval, which is the
/// state worth explaining to the user rather than reporting as a generic
/// failure.
#[tauri::command]
pub async fn helper_registration(backend: State<'_, TunnelBackend>) -> Result<SetupState, String> {
    // Reads only. Registration is attempted once at startup (see `lib.rs`); the
    // UI polls this while the user approves the helper in System Settings.
    backend.setup_state()
}

/// Hand the user straight to the approval switch in System Settings. A no-op
/// where there is no helper to approve.
#[tauri::command]
pub async fn open_helper_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    crate::helper_install::open_approval_settings();
    Ok(())
}
