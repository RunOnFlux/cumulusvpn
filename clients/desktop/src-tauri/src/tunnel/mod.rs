//! Tunnel manager — the Rust core that owns the wireguard-go sidecar, the UAPI
//! configuration, and the kill switch. The Tauri commands in `commands.rs` are
//! thin wrappers over `TunnelManager`.
//!
//! This is deliberately shaped like the seed of a Mullvad-style daemon: a
//! single owner of tunnel state behind a mutex, with the platform-specific work
//! isolated in `wggo` (crypto/data plane) and `killswitch` (firewall).

pub mod killswitch;
pub mod routing;
pub mod wggo;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use thiserror::Error;

use killswitch::Backend;
use wggo::{Sidecar, WgConfig};

/// Interface name we ask wireguard-go to create. // POC: single fixed tunnel;
/// a real build allocates `utunN` / `wg0` dynamically to avoid collisions.
const IFACE: &str = "cvpn0";

/// Outer (to ENTRY) interface name for multi-hop. // POC: fixed like [`IFACE`].
const IFACE_ENTRY: &str = "cvpn-entry";
/// Inner (to EXIT) interface name for multi-hop; carries the default route.
const IFACE_EXIT: &str = "cvpn-exit";

/// Strip a trailing `:port` from an endpoint, leaving IPv6 forms untouched —
/// mirrors the core-ts `stripEndpointPort`. `"1.2.3.4:51820"` → `"1.2.3.4"`.
fn strip_endpoint_port(endpoint: &str) -> &str {
    let e = endpoint.trim();
    if e.matches(':').count() == 1 {
        if let Some((host, _port)) = e.rsplit_once(':') {
            return host;
        }
    }
    e
}

/// Parameters for [`TunnelManager::connect_multihop`]: the two nested WireGuard
/// configs from core-ts `buildMultihopConfig` plus the routing facts.
#[derive(Debug, Clone)]
pub struct MultihopParams<'a> {
    /// ISO country of the ENTRY hop (retained for status + kill-switch scoping).
    pub entry_country: &'a str,
    /// ISO country of the EXIT hop (the effective egress location).
    pub exit_country: &'a str,
    /// Outer `.conf` (wg-entry): `AllowedIPs = <exitIp>/32`, MTU 1420, no DNS.
    pub outer: &'a str,
    /// Inner `.conf` (wg-exit): `AllowedIPs = 0.0.0.0/0, ::/0`, MTU 1340, DNS.
    pub inner: &'a str,
    /// `<entryIp>:51820` — the only real UDP egress; allow-listed by the switch.
    pub entry_endpoint: &'a str,
    /// `<exitIp>:51820` — host-routed via the outer interface.
    pub exit_endpoint: &'a str,
    /// Inner interface MTU (1340).
    pub inner_mtu: u16,
    /// Inner (exit) assigned tunnel address, surfaced back in status.
    pub assigned_ip: &'a str,
    /// Whether to engage the leak-protection kill switch for this session.
    pub kill_switch: bool,
}

/// Anything that can go wrong bringing a tunnel up or down.
#[derive(Debug, Error)]
pub enum TunnelError {
    #[error("invalid wireguard config: {0}")]
    BadConfig(&'static str),
    #[error("uapi error: {0}")]
    Uapi(&'static str),
    #[error("kill switch error: {0}")]
    KillSwitch(&'static str),
    #[error("sidecar error: {0}")]
    Sidecar(&'static str),
    #[error("no active tunnel")]
    NotConnected,
}

/// Lifecycle of the local WireGuard interface. Serialized lowercase to match
/// the `TunnelState` union in the TypeScript frontend (`src/lib/tauri.ts`).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TunnelState {
    Down,
    Connecting,
    Up,
    Error,
}

/// Status snapshot returned to the frontend. `camelCase` to match the TS
/// `TunnelStatus` interface field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    pub state: TunnelState,
    pub endpoint: Option<String>,
    pub assigned_ip: Option<String>,
    pub country: Option<String>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub last_handshake: Option<i64>,
    pub error: Option<String>,
}

/// Mutable inner state guarded by the manager's mutex.
struct Inner {
    state: TunnelState,
    endpoint: Option<String>,
    assigned_ip: Option<String>,
    country: Option<String>,
    error: Option<String>,
    sidecar: Option<Sidecar>,
    /// The inner (exit) wireguard-go device for a multi-hop session; `None` for
    /// single-hop. When present, `sidecar` is the outer (entry) device.
    exit_sidecar: Option<Sidecar>,
    /// Exit gateway IP whose host route we installed, for teardown cleanup.
    exit_ip: Option<String>,
    backend: Backend,
    /// Last stats we successfully polled, so a transient UAPI hiccup doesn't
    /// zero the counters in the UI.
    rx_bytes: u64,
    tx_bytes: u64,
    last_handshake: Option<i64>,
}

impl Inner {
    fn snapshot(&self) -> TunnelStatus {
        TunnelStatus {
            state: self.state,
            endpoint: self.endpoint.clone(),
            assigned_ip: self.assigned_ip.clone(),
            country: self.country.clone(),
            rx_bytes: self.rx_bytes,
            tx_bytes: self.tx_bytes,
            last_handshake: self.last_handshake,
            error: self.error.clone(),
        }
    }
}

/// The single owner of tunnel state; registered as Tauri managed state.
pub struct TunnelManager {
    inner: Mutex<Inner>,
}

impl Default for TunnelManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TunnelManager {
    pub fn new() -> Self {
        TunnelManager {
            inner: Mutex::new(Inner {
                state: TunnelState::Down,
                endpoint: None,
                assigned_ip: None,
                country: None,
                error: None,
                sidecar: None,
                exit_sidecar: None,
                exit_ip: None,
                backend: killswitch::detect_backend(),
                rx_bytes: 0,
                tx_bytes: 0,
                last_handshake: None,
            }),
        }
    }

    /// Bring the tunnel up: engage the kill switch, spawn wireguard-go, and
    /// push the parsed `.conf` over UAPI. `country` is retained for status and
    /// kill-switch scoping. Ordering matters — the kill switch is engaged
    /// *before* any traffic can flow, and torn down if a later step fails.
    pub fn connect(
        &self,
        country: &str,
        wg_config: &str,
        endpoint: &str,
        assigned_ip: &str,
        kill_switch: bool,
    ) -> Result<TunnelStatus, TunnelError> {
        let config = WgConfig::parse(wg_config)?;

        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");

        // Replace any existing tunnel first (including a prior multi-hop pair).
        if let Some(old) = inner.sidecar.take() {
            let _ = old.kill();
        }
        if let Some(old_exit) = inner.exit_sidecar.take() {
            let _ = old_exit.kill();
        }
        if let Some(old_exit_ip) = inner.exit_ip.take() {
            let _ = routing::clear_multihop_routes(&old_exit_ip);
        }
        inner.state = TunnelState::Connecting;
        inner.country = Some(country.to_string());
        inner.endpoint = Some(endpoint.to_string());
        inner.error = None;

        if kill_switch {
            killswitch::engage(inner.backend, endpoint, IFACE)
                .map_err(|_| TunnelError::KillSwitch("failed to engage"))?;
        }

        let sidecar = match Sidecar::spawn(IFACE) {
            Ok(s) => s,
            Err(e) => {
                let _ = killswitch::disengage(inner.backend);
                inner.state = TunnelState::Error;
                inner.error = Some(e.to_string());
                return Err(e);
            }
        };

        if let Err(e) = sidecar.configure(&config) {
            let _ = sidecar.kill();
            let _ = killswitch::disengage(inner.backend);
            inner.state = TunnelState::Error;
            inner.error = Some(e.to_string());
            return Err(e);
        }

        // Routing: pin the WireGuard endpoint to the physical gateway (so the
        // tunnel's own UDP escapes), then point the default route at the tunnel.
        let endpoint_ip = strip_endpoint_port(endpoint).to_string();
        if let Err(e) = routing::add_endpoint_bypass(&endpoint_ip) {
            let _ = sidecar.kill();
            let _ = killswitch::disengage(inner.backend);
            inner.state = TunnelState::Error;
            inner.error = Some(e.to_string());
            return Err(e);
        }
        if let Err(e) = routing::add_default_route(&sidecar.interface) {
            routing::remove_endpoint_bypass(&endpoint_ip);
            let _ = sidecar.kill();
            let _ = killswitch::disengage(inner.backend);
            inner.state = TunnelState::Error;
            inner.error = Some(e.to_string());
            return Err(e);
        }

        inner.sidecar = Some(sidecar);
        inner.assigned_ip = Some(assigned_ip.to_string());
        inner.state = TunnelState::Up;
        inner.last_handshake = Some(now_unix());
        inner.rx_bytes = 0;
        inner.tx_bytes = 0;

        Ok(inner.snapshot())
    }

    /// Bring an opt-in **multi-hop** tunnel up (`docs/11-multihop.md`): two
    /// stacked wireguard-go devices sharing the same client key `K`.
    ///
    /// Ordering mirrors single-hop but doubled: engage the kill switch on the
    /// entry endpoint (the only real UDP egress), spawn + configure the outer
    /// (entry) device from `outer`, spawn + configure the inner (exit) device
    /// from `inner`, then install the routes — host route `<exitIp>/32` → the
    /// outer interface (so only the inner tunnel's UDP to the exit traverses the
    /// entry), and the default route → the inner interface. Any failure tears
    /// down everything set up so far, so we never leave a half-open pair.
    pub fn connect_multihop(&self, params: &MultihopParams<'_>) -> Result<TunnelStatus, TunnelError> {
        // Parse both nested configs before touching any state. The outer config
        // legitimately carries no DNS; the inner sets the exit's DNS + 1340 MTU.
        let outer_cfg = WgConfig::parse(params.outer)?;
        let inner_cfg = WgConfig::parse(params.inner)?;
        let exit_ip = strip_endpoint_port(params.exit_endpoint).to_string();
        let entry_ip = strip_endpoint_port(params.entry_endpoint).to_string();

        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");

        // Replace any existing tunnel (single-hop or a prior multi-hop pair).
        if let Some(old) = inner.sidecar.take() {
            let _ = old.kill();
        }
        if let Some(old_exit) = inner.exit_sidecar.take() {
            let _ = old_exit.kill();
        }
        if let Some(old_exit_ip) = inner.exit_ip.take() {
            let _ = routing::clear_multihop_routes(&old_exit_ip);
        }

        inner.state = TunnelState::Connecting;
        // Surface the exit country as the effective location; the entry endpoint
        // is the wire endpoint (what actually leaves the host).
        inner.country = Some(params.exit_country.to_string());
        inner.endpoint = Some(params.entry_endpoint.to_string());
        inner.error = None;

        // Kill switch allow-lists the entry endpoint only — the exit is reached
        // *through* the entry tunnel, never directly from the host.
        if params.kill_switch {
            killswitch::engage(inner.backend, params.entry_endpoint, IFACE_ENTRY)
                .map_err(|_| TunnelError::KillSwitch("failed to engage"))?;
        }

        // Helper: unwind everything set up so far on any failure.
        let fail = |inner: &mut Inner,
                    entry_sc: Option<Sidecar>,
                    exit_sc: Option<Sidecar>,
                    routed: bool,
                    e: TunnelError|
         -> Result<TunnelStatus, TunnelError> {
            if routed {
                let _ = routing::clear_multihop_routes(&exit_ip);
            }
            // Best-effort: the entry bypass may or may not have been installed.
            routing::remove_endpoint_bypass(&entry_ip);
            if let Some(sc) = exit_sc {
                let _ = sc.kill();
            }
            if let Some(sc) = entry_sc {
                let _ = sc.kill();
            }
            let _ = killswitch::disengage(inner.backend);
            inner.state = TunnelState::Error;
            inner.error = Some(e.to_string());
            Err(e)
        };

        // Outer (entry) device.
        let entry_sidecar = match Sidecar::spawn(IFACE_ENTRY) {
            Ok(s) => s,
            Err(e) => return fail(&mut inner, None, None, false, e),
        };
        if let Err(e) = entry_sidecar.configure(&outer_cfg) {
            return fail(&mut inner, Some(entry_sidecar), None, false, e);
        }

        // Inner (exit) device.
        let exit_sidecar = match Sidecar::spawn(IFACE_EXIT) {
            Ok(s) => s,
            Err(e) => return fail(&mut inner, Some(entry_sidecar), None, false, e),
        };
        if let Err(e) = exit_sidecar.configure(&inner_cfg) {
            return fail(&mut inner, Some(entry_sidecar), Some(exit_sidecar), false, e);
        }

        // Routes. Use the *real* kernel-assigned device names (utunN on macOS),
        // not the logical IFACE_* labels, since that is what the routing table
        // keys on.
        let entry_if = entry_sidecar.interface.clone();
        let exit_if = exit_sidecar.interface.clone();

        // Pin the entry endpoint to the physical gateway so the outer tunnel's
        // own UDP escapes (same bypass as single-hop, on the entry endpoint).
        if let Err(e) = routing::add_endpoint_bypass(&entry_ip) {
            return fail(&mut inner, Some(entry_sidecar), Some(exit_sidecar), false, e);
        }
        // Pin the exit endpoint through the entry tunnel, then default via exit.
        if let Err(e) = routing::add_host_route(&exit_ip, &entry_if) {
            return fail(&mut inner, Some(entry_sidecar), Some(exit_sidecar), false, e);
        }
        if let Err(e) = routing::add_default_route(&exit_if) {
            return fail(&mut inner, Some(entry_sidecar), Some(exit_sidecar), true, e);
        }
        // The inner interface MTU (params.inner_mtu, 1340) is applied to the
        // exit device by `configure` from the inner `.conf`'s MTU line — wrong
        // MTU is the classic multi-hop stall. `inner_mtu` is the same value
        // surfaced independently by core-ts; kept in the signature for callers
        // that render the interface without a full `.conf`.
        let _ = params.inner_mtu;

        inner.sidecar = Some(entry_sidecar);
        inner.exit_sidecar = Some(exit_sidecar);
        inner.exit_ip = Some(exit_ip);
        inner.assigned_ip = Some(params.assigned_ip.to_string());
        inner.state = TunnelState::Up;
        inner.last_handshake = Some(now_unix());
        inner.rx_bytes = 0;
        inner.tx_bytes = 0;

        Ok(inner.snapshot())
    }

    /// Poll live counters from the sidecar and return the current status.
    pub fn status(&self) -> TunnelStatus {
        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");
        if inner.state == TunnelState::Up {
            // For multi-hop the real transfer counters live on the inner (exit)
            // device — all payload traffic flows through it; the outer only
            // carries the encapsulated tunnel. Fall back to the single-hop
            // device otherwise.
            let data_plane = inner.exit_sidecar.as_ref().or(inner.sidecar.as_ref());
            if let Some(sidecar) = data_plane {
                if let Ok(stats) = sidecar.stats() {
                    // POC: the mock sidecar reports zero; a live UAPI `get`
                    // returns real rx/tx and last-handshake here.
                    if stats.rx_bytes > 0 || stats.tx_bytes > 0 {
                        inner.rx_bytes = stats.rx_bytes;
                        inner.tx_bytes = stats.tx_bytes;
                    }
                    if stats.last_handshake.is_some() {
                        inner.last_handshake = stats.last_handshake;
                    }
                }
            }
        }
        inner.snapshot()
    }

    /// Tear the tunnel down: kill the sidecar and remove the kill switch.
    pub fn disconnect(&self) -> Result<TunnelStatus, TunnelError> {
        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");
        if let Some(sidecar) = inner.sidecar.take() {
            let _ = sidecar.kill();
        }
        // Multi-hop: also reap the inner (exit) device and clear its routes.
        if let Some(exit_sidecar) = inner.exit_sidecar.take() {
            let _ = exit_sidecar.kill();
        }
        if let Some(exit_ip) = inner.exit_ip.take() {
            let _ = routing::clear_multihop_routes(&exit_ip);
        }
        // Remove the endpoint bypass host route (entry endpoint for multi-hop,
        // the single endpoint otherwise). The split-default routes disappear
        // with the interface when its sidecar is killed above.
        if let Some(ep) = inner.endpoint.as_deref() {
            routing::remove_endpoint_bypass(strip_endpoint_port(ep));
        }
        let _ = killswitch::disengage(inner.backend);
        let backend = inner.backend;
        *inner = Inner {
            state: TunnelState::Down,
            endpoint: None,
            assigned_ip: None,
            country: None,
            error: None,
            sidecar: None,
            exit_sidecar: None,
            exit_ip: None,
            backend,
            rx_bytes: 0,
            tx_bytes: 0,
            last_handshake: None,
        };
        Ok(inner.snapshot())
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
