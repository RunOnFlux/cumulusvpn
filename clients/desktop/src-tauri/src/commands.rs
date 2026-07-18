//! Tauri command surface exposed to the React frontend.
//!
//! Contract mirrors `src/lib/tauri.ts`: `connect`, `disconnect`, `status`, all
//! returning the `camelCase` [`TunnelStatus`]. Errors are returned as strings
//! (Tauri serializes `Err(String)` into the JS promise rejection), which the
//! hook surfaces in the error banner.
//!
//! Note on the signature: the product spec lists `connect(country)`. The tunnel
//! also needs the rendered WireGuard config + endpoint, which the frontend
//! produces with `@cumulusvpn/core` (`buildWgConfig`) — so `country` leads and
//! the tunnel parameters follow. Tauri auto-maps the JS `camelCase` args
//! (`wgConfig`, `assignedIp`) to these `snake_case` parameters.

use tauri::State;

use crate::tunnel::{MultihopParams, TunnelManager, TunnelStatus};

#[tauri::command]
pub async fn connect(
    country: String,
    wg_config: String,
    endpoint: String,
    assigned_ip: String,
    kill_switch: bool,
    manager: State<'_, TunnelManager>,
) -> Result<TunnelStatus, String> {
    manager
        .connect(&country, &wg_config, &endpoint, &assigned_ip, kill_switch)
        .map_err(|e| e.to_string())
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
    manager: State<'_, TunnelManager>,
) -> Result<TunnelStatus, String> {
    manager
        .connect_multihop(&MultihopParams {
            entry_country: &entry_country,
            exit_country: &exit_country,
            outer: &outer,
            inner: &inner,
            entry_endpoint: &entry_endpoint,
            exit_endpoint: &exit_endpoint,
            inner_mtu,
            assigned_ip: &assigned_ip,
            kill_switch,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn disconnect(manager: State<'_, TunnelManager>) -> Result<TunnelStatus, String> {
    manager.disconnect().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn status(manager: State<'_, TunnelManager>) -> Result<TunnelStatus, String> {
    Ok(manager.status())
}
