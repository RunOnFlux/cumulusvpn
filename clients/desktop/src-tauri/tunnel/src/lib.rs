//! Tunnel manager — the Rust core that owns the wireguard-go sidecar, the UAPI
//! configuration, and the kill switch.
//!
//! A single owner of tunnel state behind a mutex, with the platform-specific
//! work isolated in `wggo` (crypto/data plane), `routing` (routes, addresses),
//! `killswitch` (firewall) and `dns` (the system resolver).
//!
//! **Where it runs.** There is exactly one copy of this code, and it normally
//! runs inside the privileged `cumulusvpn-helper` daemon, which the app drives
//! over local IPC while staying unprivileged itself:
//!
//! * **macOS**: a LaunchDaemon registered with `SMAppService` (Unix socket).
//! * **Linux**: a systemd service installed by the .deb / .rpm (Unix socket).
//! * **Windows**: a LocalSystem service registered by the installer (named
//!   pipe).
//!
//! An elevated app can also run it in-process: on macOS when launched as root,
//! on Linux and Windows when no daemon answers (an AppImage, a build without
//! its service). `ensure_elevated` turns a missing Administrator token into one
//! actionable error up front on Windows.
//!
//! Every host drives it the same way. They pass the wire-level requests from
//! `cumulusvpn-protocol` ([`TunnelManager::connect_request`],
//! [`TunnelManager::connect_multihop_request`]), which are shape-checked first
//! (`validate`) because on Linux and Windows the daemon's peers are less
//! trusted than a signed app; and they run [`spawn_repair_loop`] so that roam
//! repair and the dead-tunnel watchdog keep working when no UI is polling.

pub mod dns;
pub mod killswitch;
pub mod routing;
pub mod tlsbridge;
mod validate;
pub mod wggo;

use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use thiserror::Error;

pub use cumulusvpn_protocol::{
    ConnectRequest, MultihopRequest, SplitParams, TlsParams, TunnelState, TunnelStatus,
};

use killswitch::Backend;
use wggo::{Sidecar, WgConfig};

/// `CREATE_NO_WINDOW` process-creation flag. The app is a GUI process, so every
/// child we spawn (netsh/route/powershell/wireguard-go) would otherwise flash a
/// console window on screen. Shared by the `wggo` and `routing` submodules.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Fail fast if the process cannot edit the network stack. On Windows every
/// step of a connect — creating the wintun adapter, opening the
/// `ProtectedPrefix` UAPI pipe, netsh route edits, the firewall kill switch —
/// needs Administrator, and each would otherwise fail mid-connect with its own
/// cryptic error; one check up front turns that into a single actionable
/// message. Detection is the exact `WindowsPrincipal` role test via PowerShell
/// (already this codebase's Windows toolbox — see `killswitch`) rather than a
/// new windows-sys dependency.
#[cfg(windows)]
fn ensure_elevated() -> Result<(), TunnelError> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match out {
        Ok(o)
            if o.status.success()
                && String::from_utf8_lossy(&o.stdout)
                    .trim()
                    .eq_ignore_ascii_case("true") =>
        {
            Ok(())
        }
        // Cannot prove elevation (including a missing/failed PowerShell): the
        // connect would fail anyway, so surface the actionable message now.
        _ => Err(TunnelError::Sidecar(
            "not running elevated — run CumulusVPN as Administrator",
        )),
    }
}

/// macOS and Linux need root too. This code normally runs inside the root
/// helper daemon; in the in-process fallback the app itself must be root.
/// Unelevated, their commands fail with clear "needs root" errors, so no
/// separate pre-check is needed.
#[cfg(not(windows))]
fn ensure_elevated() -> Result<(), TunnelError> {
    Ok(())
}

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

// The status, parameter and request types are defined in `cumulusvpn-protocol`.
// They cross the app<->helper channel and are also the in-process interface,
// so the wire definition is the single source of truth.
// Re-exported above for this crate's callers. `MultihopParams` stays here: it
// borrows, and never crosses the wire.

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
    /// Compiled split-tunneling routes; `None`/empty = full tunnel. Applies to
    /// the inner (exit) device — that is where the default route lives (§7.2).
    pub split: Option<&'a SplitParams>,
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
    /// The UDP<->TLS bridge for a `wg-tls` session; `None` for vanilla/awg. Kept
    /// alive for the session's lifetime and torn down on replace/disconnect.
    bridge: Option<tlsbridge::ClientBridge>,
    /// Exit gateway IP whose host route we installed, for teardown cleanup.
    exit_ip: Option<String>,
    /// Split-tunneling bypass routes we installed, for teardown cleanup.
    /// (Include-mode tunnel routes are interface-scoped and die with the
    /// device, so they need no tracking.)
    bypass_routes: Vec<String>,
    /// The system resolver pointed at the tunnel's, for this session. Applied
    /// last on connect, re-asserted by the repair loop, restored first on
    /// teardown. Its warning is what the UI shows when DNS could not be set.
    dns: Option<dns::DnsSession>,
    backend: Backend,
    /// Source address the OS last chose for the entry gateway. A change means
    /// the machine roamed (different Wi-Fi, dock/undock, cellular tether) and
    /// the sidecar's socket is now bound to an interface that has gone.
    local_src: Option<IpAddr>,
    /// Last stats we successfully polled, so a transient UAPI hiccup doesn't
    /// zero the counters in the UI.
    rx_bytes: u64,
    tx_bytes: u64,
    last_handshake: Option<i64>,
    /// When the last roam repair succeeded, so the watchdog can give it a moment
    /// to prove itself. See `is_dead`.
    repaired_at: Option<Instant>,
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
            dns_warning: self.dns.as_ref().and_then(dns::DnsSession::warning),
        }
    }

    /// Put the system resolver back, if this session changed it. First thing
    /// on every teardown and replace, while the old tunnel still exists.
    fn restore_dns(&mut self) {
        if let Some(session) = self.dns.take() {
            session.restore();
        }
    }
}

impl Inner {
    /// Notice that the machine changed network, and put the tunnel back.
    ///
    /// Laptops roam as much as phones — a different Wi-Fi, undocking Ethernet,
    /// tethering — and WireGuard does not recover on its own. The gateway half
    /// is automatic (it relearns a peer's endpoint from any authenticated
    /// packet), but the client's socket stays bound to the interface that went
    /// away, so nothing is ever sent and nothing is ever relearned. The OS keeps
    /// the interface up throughout, so no error is raised and the UI still says
    /// connected while no traffic moves.
    ///
    /// Two transports, two answers, matching the mobile clients:
    ///
    /// * **vanilla / awg** — only the socket is stale. Rebinding reopens it on
    ///   the new interface; the session, keys and counters all survive.
    /// * **wg-tls** — the socket that died is `ClientBridge`'s TCP connection to
    ///   the relay, which cannot migrate and has no reconnect. Rebinding a
    ///   device pointed at the local bridge would achieve nothing, so the tunnel
    ///   is failed instead and the UI's auto-reconnect rebuilds it.
    ///
    /// In multi-hop only the OUTER (entry) sidecar holds a socket on the
    /// physical network. The inner one reaches the exit through the outer
    /// tunnel, whose interface a roam does not disturb.
    fn repair_after_roam(&mut self) {
        let Some(endpoint) = self.endpoint.clone() else {
            return;
        };
        let Some(src) = local_source_for(&endpoint) else {
            // No route to the gateway at all right now — mid-switch, or simply
            // offline. Leave the recorded address alone so the NEXT poll, once a
            // route exists, compares against where we were and still sees the
            // change.
            return;
        };
        let previous = self.local_src.replace(src);
        // `is_none_or` would read better but is stable only since 1.82; the
        // crate declares rust-version = 1.77.
        match previous {
            Some(p) if p != src => {}
            // First observation, or nothing moved.
            _ => return,
        }

        if self.bridge.is_some() {
            self.state = TunnelState::Error;
            self.error = Some("network changed — reconnecting".into());
            return;
        }

        // Fix the ROUTE before the socket. The endpoint bypass is a host route
        // to the gateway via the router that was default at connect time; on the
        // new network that next hop is unreachable, so the sidecar's packets are
        // blackholed no matter which interface its socket is bound to. Rebinding
        // without this repairs nothing.
        if let Err(e) = routing::repoint_endpoint_bypass(strip_endpoint_port(&endpoint)) {
            // No usable default route yet — mid-switch. Restore the recorded
            // address so the next poll sees the change afresh and retries.
            self.local_src = previous;
            self.error = Some(format!("route repair after network change failed: {e}"));
            return;
        }

        // Outer device for multi-hop, the only device for single-hop.
        if let Some(sidecar) = self.sidecar.as_ref() {
            if let Err(e) = sidecar.rebind() {
                // The new interface may not be usable yet. Clear the recorded
                // address so the next poll treats this as a fresh change and
                // tries again, rather than deciding nothing moved.
                self.local_src = previous;
                self.error = Some(format!("rebind after network change failed: {e}"));
                return;
            }
        }
        // A repair clears the previous attempt's error; the tunnel is whole.
        self.error = None;
        self.repaired_at = Some(Instant::now());
    }

    /// Is the tunnel dead despite the OS reporting it up?
    ///
    /// The backstop for every break that `repair_after_roam` cannot see. It keys
    /// on the source address for the gateway changing, which covers a roam — but
    /// says nothing about a DHCP renewal that returns the SAME address, a NAT
    /// rebind upstream, a wake-from-sleep on the same network, or the gateway
    /// simply dying. In all of those the interface stays up and no error is ever
    /// raised, so without this the UI reads "protected" over a tunnel that has
    /// been carrying nothing for minutes. Mirrors `isTunnelDead` in the mobile
    /// client (`useVpn.ts`) — same threshold, same reasoning.
    fn is_dead(&self) -> bool {
        if self.state != TunnelState::Up {
            return false;
        }
        // A repair that lands on an already-stale handshake would otherwise be
        // torn down before its first keepalive: the rebind is instant, but the
        // handshake that proves it worked is up to a keepalive interval (25s)
        // behind. Give a fresh repair that long plus margin to show a result.
        if self.repaired_at.is_some_and(|t| t.elapsed() < REPAIR_GRACE) {
            return false;
        }
        let Some(last) = self.last_handshake else {
            // No handshake recorded yet: still coming up, not dead. A connect
            // that never completes is caught by the connect path, not here.
            return false;
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        now - last > HANDSHAKE_DEAD_SEC
    }
}

/// How stale the last handshake may get before the tunnel counts as dead.
///
/// The threshold cannot be tightened much. A healthy tunnel's handshake age
/// sawtooths between 0 and ~120s (`REKEY_AFTER_TIME`) — keepalives count as
/// sends, so a rekey is attempted about every two minutes. Anything below that
/// would tear down working tunnels on the ordinary rekey sawtooth. 200s is
/// unambiguously dead rather than merely idle, with margin for clock skew
/// between our clock and the sidecar's counter. Same value as the mobile client.
const HANDSHAKE_DEAD_SEC: i64 = 200;

/// How long a successful roam repair is shielded from the watchdog — one
/// WireGuard keepalive interval (25s) plus margin for the handshake to complete.
const REPAIR_GRACE: Duration = Duration::from_secs(40);

/// Whether the kill switch needs the phase-2 re-engage once the kernel tun
/// names are known. Only macOS does: pf cannot name `utunN` up front, so phase 1
/// blocks it and phase 2 passes it. Linux (nftables) and Windows (WFP) already
/// allow the tun by the `cvpn*` prefix in phase 1 and ignore `tun_interfaces`,
/// so re-engaging there would only re-apply the identical ruleset. On Windows
/// that costs several PowerShell round-trips per hop. Skipping it keeps their
/// connect sequence exactly what it was before the helper split: one engage.
const KILL_SWITCH_NEEDS_TUN_PASS: bool = cfg!(target_os = "macos");

/// Phase-2 kill-switch engage: replace the ruleset with one that also passes
/// traffic out the named kernel tun devices.
///
/// Split out because both `connect` and `connect_multihop` need it, and multi-hop
/// needs it twice — the exit device's handshake travels through the entry tunnel,
/// so the entry tun must be passable before the exit sidecar is configured.
/// Re-engaging is an atomic replace, so there is never an unprotected window.
#[allow(clippy::too_many_arguments)]
fn engage_with_tuns(
    backend: killswitch::Backend,
    endpoint: &str,
    interface: &str,
    proto: killswitch::Proto,
    bypass_cidrs: &[String],
    tuns: &[String],
    dns_servers: &[IpAddr],
    tunnel_address: Option<IpAddr>,
) -> Result<(), TunnelError> {
    killswitch::engage(
        backend,
        &killswitch::LeakPolicy {
            endpoint,
            interface,
            tun_interfaces: tuns,
            proto,
            bypass_cidrs,
            bypass_apps: &[],
            dns_servers,
            tunnel_address,
        },
    )
}

/// The resolver(s) and tunnel address a parsed `.conf` names, typed. These
/// reach firewall rules and scripts, so they are parsed here rather than passed
/// on as text.
fn dns_facts(config: &WgConfig) -> (Vec<IpAddr>, Option<IpAddr>) {
    let servers = config
        .dns
        .as_deref()
        .map(dns::parse_servers)
        .unwrap_or_default();
    (servers, config.address.parse().ok())
}

/// The address the OS would send from to reach `endpoint`, or `None` if it has
/// no route there.
///
/// Connecting a UDP socket sends nothing — it only asks the kernel to pick a
/// route and bind a source address — so this is a free question to ask on every
/// status poll. It answers the one that matters: the gateway keeps a host route
/// on the PHYSICAL interface (that is what stops the tunnel carrying its own
/// packets), so the source address for it tracks the real network and changes
/// exactly when the machine roams.
///
/// Parsed as a `SocketAddr` rather than resolved, so a poll can never block on
/// DNS. Our endpoints are always literal IPs.
fn local_source_for(endpoint: &str) -> Option<IpAddr> {
    let addr: SocketAddr = endpoint.parse().ok()?;
    let bind = if addr.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    let sock = UdpSocket::bind(bind).ok()?;
    sock.connect(addr).ok()?;
    Some(sock.local_addr().ok()?.ip())
}

/// The single owner of tunnel state. Held by the helper daemon, or by the app
/// itself when it runs the tunnel in-process.
pub struct TunnelManager {
    inner: Mutex<Inner>,
}

impl Default for TunnelManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Cadence of the background repair/watchdog poll. Matches the UI's status
/// poll, which this replaces whenever the window is hidden or throttled.
pub const REPAIR_POLL_INTERVAL: Duration = Duration::from_millis(1500);

/// Drive [`TunnelManager::status`] forever on a dedicated thread.
///
/// Roam repair and the dead-tunnel watchdog both run inside `status()`. If the
/// webview's poll were the only caller, a hidden, minimised or throttled window
/// would stop the tunnel recovering from a Wi-Fi change. Both hosts call this:
/// the helper daemon at startup, and the app when it builds an in-process
/// tunnel.
///
/// The cost is negligible. A down tunnel is a mutex lock and a clone. An up one
/// adds a route lookup that sends no packet, and a UAPI `get`.
pub fn spawn_repair_loop(manager: Arc<TunnelManager>) -> thread::JoinHandle<()> {
    thread::spawn(move || loop {
        thread::sleep(REPAIR_POLL_INTERVAL);
        let _ = manager.status();
    })
}

impl TunnelManager {
    /// Bring a single-hop tunnel up from its wire-level request.
    ///
    /// The one place a [`ConnectRequest`] is unpacked into [`Self::connect`],
    /// shared by the helper daemon's dispatch and the app's in-process path, so
    /// the two cannot drift apart.
    pub fn connect_request(&self, r: &ConnectRequest) -> Result<TunnelStatus, TunnelError> {
        // Before anything is touched: a refused request leaves the current
        // session (if any) exactly as it was.
        validate::connect_request(r)?;
        self.connect(
            &r.country,
            &r.wg_config,
            &r.endpoint,
            &r.assigned_ip,
            r.kill_switch,
            r.tls.clone(),
            r.split.as_ref(),
        )
    }

    /// Bring a multi-hop tunnel up from its wire-level request. See
    /// [`Self::connect_request`].
    pub fn connect_multihop_request(
        &self,
        r: &MultihopRequest,
    ) -> Result<TunnelStatus, TunnelError> {
        validate::multihop_request(r)?;
        self.connect_multihop(&MultihopParams {
            entry_country: &r.entry_country,
            exit_country: &r.exit_country,
            outer: &r.outer,
            inner: &r.inner,
            entry_endpoint: &r.entry_endpoint,
            exit_endpoint: &r.exit_endpoint,
            inner_mtu: r.inner_mtu,
            assigned_ip: &r.assigned_ip,
            kill_switch: r.kill_switch,
            split: r.split.as_ref(),
        })
    }

    pub fn new() -> Self {
        TunnelManager {
            inner: Mutex::new(Inner {
                state: TunnelState::Down,
                endpoint: None,
                assigned_ip: None,
                country: None,
                local_src: None,
                error: None,
                sidecar: None,
                exit_sidecar: None,
                bridge: None,
                exit_ip: None,
                bypass_routes: Vec::new(),
                dns: None,
                backend: killswitch::detect_backend(),
                rx_bytes: 0,
                tx_bytes: 0,
                last_handshake: None,
                repaired_at: None,
            }),
        }
    }

    /// Bring the tunnel up: engage the kill switch, spawn wireguard-go, and
    /// push the parsed `.conf` over UAPI. `country` is retained for status and
    /// kill-switch scoping. Ordering matters — the kill switch is engaged
    /// *before* any traffic can flow, and torn down if a later step fails.
    #[allow(clippy::too_many_arguments)]
    pub fn connect(
        &self,
        country: &str,
        wg_config: &str,
        endpoint: &str,
        assigned_ip: &str,
        kill_switch: bool,
        tls: Option<TlsParams>,
        split: Option<&SplitParams>,
    ) -> Result<TunnelStatus, TunnelError> {
        ensure_elevated()?;
        let mut config = WgConfig::parse(wg_config)?;
        let (dns_servers, tunnel_address) = dns_facts(&config);
        // wg-tls rides a TLS/TCP session; vanilla/awg dial the gateway over UDP.
        // The kill switch + endpoint bypass are scoped to `endpoint` (the real
        // gateway address) either way — for wg-tls that's the TLS relay's TCP
        // port, and the WG device's own socket is loopback to the local bridge.
        let proto = if tls.is_some() {
            killswitch::Proto::Tcp
        } else {
            killswitch::Proto::Udp
        };

        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");

        // Replace any existing tunnel first (including a prior multi-hop pair).
        // This path is reachable via auto-reconnect/failover WITHOUT an
        // intervening disconnect(), so it must fully clear the previous session's
        // leak-protection state, not just its sidecars. DNS first, while the old
        // device it may be bound to still exists.
        inner.restore_dns();
        if let Some(old) = inner.sidecar.take() {
            let _ = old.kill();
        }
        if let Some(old_exit) = inner.exit_sidecar.take() {
            let _ = old_exit.kill();
        }
        if let Some(mut old_bridge) = inner.bridge.take() {
            old_bridge.shutdown();
        }
        if let Some(old_exit_ip) = inner.exit_ip.take() {
            let _ = routing::clear_multihop_routes(&old_exit_ip);
        }
        // Remove the previous endpoint's /32 bypass route before we overwrite
        // inner.endpoint — otherwise each reconnect strands it, and a stale route
        // to a former gateway IP can later blackhole traffic to that IP.
        if let Some(old_endpoint) = inner.endpoint.take() {
            routing::remove_endpoint_bypass(strip_endpoint_port(&old_endpoint));
        }
        // Split-tunneling state is SESSION state (§7.4): drop the previous
        // session's bypass routes before this one installs its own.
        let old_bypass = std::mem::take(&mut inner.bypass_routes);
        routing::remove_bypass_routes(&old_bypass);
        let split_bypass: &[String] = split.map(|s| s.bypass_routes.as_slice()).unwrap_or(&[]);
        let split_tunnel: &[String] = split.map(|s| s.tunnel_routes.as_slice()).unwrap_or(&[]);
        inner.state = TunnelState::Connecting;
        inner.country = Some(country.to_string());
        inner.endpoint = Some(endpoint.to_string());
        inner.error = None;

        // Leak protection. engage REPLACES any prior ruleset atomically (no open
        // window), so re-engaging on reconnect is safe. But when THIS session has
        // the kill switch OFF, we must tear down any ruleset a prior session left
        // engaged — otherwise the user's "off" is ignored AND the stale allow-rule
        // (pinned to the old endpoint) drops this tunnel's handshake.
        //
        // Every split bypass prefix is punched through as `bypass_cidrs` —
        // without the matching hole, split tunneling would silently do nothing
        // while appearing configured (docs/17 §7.1).
        if kill_switch {
            killswitch::engage(
                inner.backend,
                &killswitch::LeakPolicy {
                    endpoint,
                    interface: IFACE,
                    // Phase 1: the sidecar does not exist yet, so there is no tun
                    // name to allow — and nothing to allow it for. Phase 2 runs
                    // below, once `Sidecar::spawn` reports the real name.
                    tun_interfaces: &[],
                    proto,
                    bypass_cidrs: split_bypass,
                    bypass_apps: &[],
                    dns_servers: &dns_servers,
                    tunnel_address,
                },
            )
            .map_err(|_| TunnelError::KillSwitch("failed to engage"))?;
        } else {
            let _ = killswitch::disengage(inner.backend);
        }

        // wg-tls: stand up the UDP<->TLS bridge to the gateway relay and point the
        // WG device at its LOCAL udp endpoint. The bridge's TLS connection is made
        // now, before the default route flips to the tunnel, and kept on the
        // physical by the endpoint bypass below. `bridge` drops (shutting the TLS
        // connection) on any error return before it's stored in `inner`.
        let bridge = if let Some(tls) = tls.as_ref() {
            match tlsbridge::ClientBridge::connect(&tls.server_addr, &tls.sni) {
                Ok(b) => {
                    config.endpoint = b.local_endpoint();
                    Some(b)
                }
                Err(e) => {
                    let _ = killswitch::disengage(inner.backend);
                    inner.state = TunnelState::Error;
                    inner.error = Some(e.to_string());
                    return Err(e);
                }
            }
        } else {
            None
        };

        let sidecar = match Sidecar::spawn(IFACE) {
            Ok(s) => s,
            Err(e) => {
                let _ = killswitch::disengage(inner.backend);
                inner.state = TunnelState::Error;
                inner.error = Some(e.to_string());
                return Err(e);
            }
        };

        // Phase 2: the kernel tun name is known now, so re-engage with the pass
        // that lets tunnel traffic out. Before `configure`, so the rule is in
        // place ahead of the first handshake rather than racing it. macOS only:
        // on Linux and Windows the `cvpn*` prefix already covers the real name
        // (see `KILL_SWITCH_NEEDS_TUN_PASS`).
        if kill_switch && KILL_SWITCH_NEEDS_TUN_PASS {
            let tuns = [sidecar.interface.clone()];
            if let Err(e) = engage_with_tuns(
                inner.backend,
                endpoint,
                IFACE,
                proto,
                split_bypass,
                &tuns,
                &dns_servers,
                tunnel_address,
            ) {
                let _ = sidecar.kill();
                let _ = killswitch::disengage(inner.backend);
                inner.state = TunnelState::Error;
                inner.error = Some(e.to_string());
                return Err(e);
            }
        }

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
        // Include mode routes ONLY the listed prefixes into the tunnel (the
        // default stays physical); otherwise install the split-default pair
        // and, in exclude mode, the more-specific bypass routes that win over
        // it. Bypass routes are installed after the default flip so there is no
        // window where excluded traffic tunnels — wrong direction of surprise.
        let route_result = if !split_tunnel.is_empty() {
            routing::add_tunnel_routes(split_tunnel, &sidecar.interface)
        } else {
            routing::add_default_route(&sidecar.interface)
                .and_then(|()| routing::add_bypass_routes(split_bypass))
        };
        if let Err(e) = route_result {
            routing::remove_bypass_routes(split_bypass);
            routing::remove_endpoint_bypass(&endpoint_ip);
            let _ = sidecar.kill();
            let _ = killswitch::disengage(inner.backend);
            inner.state = TunnelState::Error;
            inner.error = Some(e.to_string());
            return Err(e);
        }
        inner.bypass_routes = split_bypass.to_vec();

        // DNS last: only now do the routes send the resolver's traffic into the
        // tunnel. Never fails the connect — a DNS failure is a warning on the
        // status, and the repair loop keeps retrying.
        inner.dns = Some(dns::DnsSession::start(dns::DnsTarget {
            interface: sidecar.interface.clone(),
            servers: dns_servers,
            tunnel_address,
            endpoint_ips: endpoint_ip.parse().ok().into_iter().collect(),
            pin_route: split.is_some(),
            kill_switch,
        }));

        inner.sidecar = Some(sidecar);
        inner.bridge = bridge; // keep the wg-tls bridge alive for the session
        inner.assigned_ip = Some(assigned_ip.to_string());
        inner.state = TunnelState::Up;
        // NOT a handshake: the interface is configured, but no WireGuard
        // handshake has happened yet. Seeding a timestamp here would make a
        // never-connecting tunnel indistinguishable from a live one — status()
        // only ever replaces this with a real UAPI value, so a placeholder can
        // never be cleared. Leaving it None makes `lastHandshake != null` an
        // authoritative "the peer answered" signal for the frontend.
        inner.last_handshake = None;
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
    pub fn connect_multihop(
        &self,
        params: &MultihopParams<'_>,
    ) -> Result<TunnelStatus, TunnelError> {
        ensure_elevated()?;
        // Parse both nested configs before touching any state. The outer config
        // legitimately carries no DNS; the inner sets the exit's DNS + 1340 MTU.
        let outer_cfg = WgConfig::parse(params.outer)?;
        let inner_cfg = WgConfig::parse(params.inner)?;
        // DNS belongs to the inner (exit) device: that is where the default
        // route, and so the resolver's traffic, goes.
        let (dns_servers, tunnel_address) = dns_facts(&inner_cfg);
        let exit_ip = strip_endpoint_port(params.exit_endpoint).to_string();
        let entry_ip = strip_endpoint_port(params.entry_endpoint).to_string();

        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");

        // Replace any existing tunnel (single-hop or a prior multi-hop pair).
        // Reachable via reconnect without a disconnect(), so clear the previous
        // session's leak-protection state fully (see connect()).
        inner.restore_dns();
        if let Some(old) = inner.sidecar.take() {
            let _ = old.kill();
        }
        if let Some(old_exit) = inner.exit_sidecar.take() {
            let _ = old_exit.kill();
        }
        if let Some(mut old_bridge) = inner.bridge.take() {
            old_bridge.shutdown();
        }
        if let Some(old_exit_ip) = inner.exit_ip.take() {
            let _ = routing::clear_multihop_routes(&old_exit_ip);
        }
        if let Some(old_endpoint) = inner.endpoint.take() {
            routing::remove_endpoint_bypass(strip_endpoint_port(&old_endpoint));
        }
        // Drop the previous session's split bypass routes (session state, §7.4).
        let old_bypass = std::mem::take(&mut inner.bypass_routes);
        routing::remove_bypass_routes(&old_bypass);
        let split_bypass: &[String] = params
            .split
            .map(|s| s.bypass_routes.as_slice())
            .unwrap_or(&[]);
        let split_tunnel: &[String] = params
            .split
            .map(|s| s.tunnel_routes.as_slice())
            .unwrap_or(&[]);

        inner.state = TunnelState::Connecting;
        // Surface the exit country as the effective location; the entry endpoint
        // is the wire endpoint (what actually leaves the host).
        inner.country = Some(params.exit_country.to_string());
        inner.endpoint = Some(params.entry_endpoint.to_string());
        inner.error = None;

        // Kill switch allow-lists the entry endpoint only — the exit is reached
        // *through* the entry tunnel, never directly from the host. Multi-hop is
        // vanilla UDP today (Stealth+multi-hop isn't wired), so proto is Udp. Off
        // → tear down any ruleset a prior session left engaged (see connect()).
        // Split bypass prefixes are punched through here too — the compile step
        // already rejects prefixes containing the entry/exit endpoints, so the
        // bypass can never shadow the entry allowance (§7.2).
        if params.kill_switch {
            killswitch::engage(
                inner.backend,
                &killswitch::LeakPolicy {
                    endpoint: params.entry_endpoint,
                    interface: IFACE_ENTRY,
                    // Phase 1 — no devices yet. See connect().
                    tun_interfaces: &[],
                    proto: killswitch::Proto::Udp,
                    bypass_cidrs: split_bypass,
                    bypass_apps: &[],
                    dns_servers: &dns_servers,
                    tunnel_address,
                },
            )
            .map_err(|_| TunnelError::KillSwitch("failed to engage"))?;
        } else {
            let _ = killswitch::disengage(inner.backend);
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
        // Phase 2a: allow the entry tun. This is not just for the entry's own
        // payload — the EXIT device's handshake is encapsulated and leaves the
        // host through this device, so it must be passable before the exit
        // sidecar is configured below. macOS only (`KILL_SWITCH_NEEDS_TUN_PASS`).
        if params.kill_switch && KILL_SWITCH_NEEDS_TUN_PASS {
            let tuns = [entry_sidecar.interface.clone()];
            if let Err(e) = engage_with_tuns(
                inner.backend,
                params.entry_endpoint,
                IFACE_ENTRY,
                killswitch::Proto::Udp,
                split_bypass,
                &tuns,
                &dns_servers,
                tunnel_address,
            ) {
                return fail(&mut inner, Some(entry_sidecar), None, false, e);
            }
        }
        if let Err(e) = entry_sidecar.configure(&outer_cfg) {
            return fail(&mut inner, Some(entry_sidecar), None, false, e);
        }

        // Inner (exit) device.
        let exit_sidecar = match Sidecar::spawn(IFACE_EXIT) {
            Ok(s) => s,
            Err(e) => return fail(&mut inner, Some(entry_sidecar), None, false, e),
        };
        // Phase 2b: both devices known. macOS only, as above.
        if params.kill_switch && KILL_SWITCH_NEEDS_TUN_PASS {
            let tuns = [
                entry_sidecar.interface.clone(),
                exit_sidecar.interface.clone(),
            ];
            if let Err(e) = engage_with_tuns(
                inner.backend,
                params.entry_endpoint,
                IFACE_ENTRY,
                killswitch::Proto::Udp,
                split_bypass,
                &tuns,
                &dns_servers,
                tunnel_address,
            ) {
                return fail(
                    &mut inner,
                    Some(entry_sidecar),
                    Some(exit_sidecar),
                    false,
                    e,
                );
            }
        }
        if let Err(e) = exit_sidecar.configure(&inner_cfg) {
            return fail(
                &mut inner,
                Some(entry_sidecar),
                Some(exit_sidecar),
                false,
                e,
            );
        }

        // Routes. Use the *real* kernel-assigned device names (utunN on macOS),
        // not the logical IFACE_* labels, since that is what the routing table
        // keys on.
        let entry_if = entry_sidecar.interface.clone();
        let exit_if = exit_sidecar.interface.clone();

        // Pin the entry endpoint to the physical gateway so the outer tunnel's
        // own UDP escapes (same bypass as single-hop, on the entry endpoint).
        if let Err(e) = routing::add_endpoint_bypass(&entry_ip) {
            return fail(
                &mut inner,
                Some(entry_sidecar),
                Some(exit_sidecar),
                false,
                e,
            );
        }
        // Pin the exit endpoint through the entry tunnel, then default via exit.
        if let Err(e) = routing::add_host_route(&exit_ip, &entry_if) {
            return fail(
                &mut inner,
                Some(entry_sidecar),
                Some(exit_sidecar),
                false,
                e,
            );
        }
        // Split rules apply to the inner (exit) device — that is where the
        // default route lives (§7.2). Include mode: only the listed prefixes
        // via the exit device; otherwise split-default + bypass routes.
        let route_result = if !split_tunnel.is_empty() {
            routing::add_tunnel_routes(split_tunnel, &exit_if)
        } else {
            routing::add_default_route(&exit_if)
                .and_then(|()| routing::add_bypass_routes(split_bypass))
        };
        if let Err(e) = route_result {
            routing::remove_bypass_routes(split_bypass);
            return fail(&mut inner, Some(entry_sidecar), Some(exit_sidecar), true, e);
        }
        inner.bypass_routes = split_bypass.to_vec();
        // The inner interface MTU (params.inner_mtu, 1340) is applied to the
        // exit device by `configure` from the inner `.conf`'s MTU line — wrong
        // MTU is the classic multi-hop stall. `inner_mtu` is the same value
        // surfaced independently by core-ts; kept in the signature for callers
        // that render the interface without a full `.conf`.
        let _ = params.inner_mtu;

        // DNS last, on the exit device (see connect()). Neither hop's address is
        // ever pinned into the tunnel or caught by the DNS block.
        let endpoint_ips: Vec<IpAddr> = [entry_ip.as_str(), exit_ip.as_str()]
            .iter()
            .filter_map(|ip| ip.parse().ok())
            .collect();
        inner.dns = Some(dns::DnsSession::start(dns::DnsTarget {
            interface: exit_if.clone(),
            servers: dns_servers,
            tunnel_address,
            endpoint_ips,
            pin_route: params.split.is_some(),
            kill_switch: params.kill_switch,
        }));

        inner.sidecar = Some(entry_sidecar);
        inner.exit_sidecar = Some(exit_sidecar);
        inner.exit_ip = Some(exit_ip);
        inner.assigned_ip = Some(params.assigned_ip.to_string());
        inner.state = TunnelState::Up;
        inner.last_handshake = None; // see connect(): only a real UAPI value counts
        inner.rx_bytes = 0;
        inner.tx_bytes = 0;

        Ok(inner.snapshot())
    }

    /// Poll live counters from the sidecar and return the current status.
    pub fn status(&self) -> TunnelStatus {
        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");
        if inner.state == TunnelState::Up {
            inner.repair_after_roam();
            // After the route repair: a roam is exactly when the OS republishes
            // the new network's resolver over ours (macOS), and when a DNS apply
            // that failed may now succeed.
            if let Some(session) = inner.dns.as_mut() {
                session.reassert();
            }
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
            // Checked after the counters are refreshed, so it judges the newest
            // handshake rather than the previous poll's. Flipping to Error is
            // what the frontend's auto-reconnect watches for; the kill switch
            // stays engaged throughout, so a dead tunnel fails closed.
            if inner.is_dead() {
                inner.state = TunnelState::Error;
                inner.error = Some("connection lost — no handshake".into());
            }
        }
        inner.snapshot()
    }

    /// Put back system DNS left changed by a host that died mid-session (the
    /// macOS helper killed and restarted by launchd, the in-process app killed
    /// outright). Call once at startup. A no-op if this manager already has a
    /// session — whatever it applied is live, not stale — and when nothing is
    /// stale. Takes the manager lock, so a connect racing it simply waits.
    ///
    /// This is all macOS does at startup, by design: a restarted helper leaves
    /// a pf anchor from the previous instance in place (fail-closed until the
    /// app reconnects, row H15), and pf state never survives a reboot. Linux
    /// and Windows use [`Self::recover_stale`].
    pub fn recover_stale_dns(&self) {
        let inner = self.inner.lock().expect("tunnel mutex poisoned");
        if inner.state != TunnelState::Down || inner.dns.is_some() {
            return;
        }
        dns::recover_stale(&[IFACE, IFACE_EXIT]);
    }

    /// Clean up everything a host that died mid-session can leave behind: the
    /// system DNS, orphaned `wireguard-go` processes (whose tun devices, and the
    /// routes through them, go with them), and the kill switch. Linux and
    /// Windows call this once at startup — the helper daemon, and the elevated
    /// in-process app — before anything can connect.
    ///
    /// Why the kill switch too: at startup there is no session to protect. The
    /// sidecar that carried the tunnel is dead (systemd kills the service's
    /// cgroup; on Windows it is reaped here), so the rules can only block, and
    /// nobody is left who knows to lift them. On Windows they would even
    /// outlive a reboot, since `DefaultOutboundAction` is persistent firewall
    /// policy. If the app is running it sees the drop and reconnects, which
    /// re-engages the switch for the new session.
    ///
    /// Order mirrors [`Self::disconnect`]: DNS first, then the devices, the
    /// kill switch last. Each step is a no-op when nothing of ours is there, and
    /// none touches state that is not ours (our nft table, our firewall-rule
    /// groups, sidecars started from our own binary for our interface names).
    /// Like [`Self::recover_stale_dns`], a no-op if this manager has a session.
    pub fn recover_stale(&self) {
        let inner = self.inner.lock().expect("tunnel mutex poisoned");
        if inner.state != TunnelState::Down || inner.dns.is_some() {
            return;
        }
        dns::recover_stale(&[IFACE, IFACE_EXIT]);
        wggo::reap_orphans(&[IFACE, IFACE_ENTRY, IFACE_EXIT]);
        killswitch::recover_stale(inner.backend);
    }

    /// Tear down only if something is up. Returns whether it did.
    ///
    /// The quit and stop paths use this rather than [`Self::disconnect`],
    /// which is unconditional by design: it lifts the kill switch and restores
    /// the platform firewall default whether or not we engaged anything (on
    /// Windows, `DefaultOutboundAction Allow` on every profile). That is right
    /// for an explicit Disconnect, but wrong for an app quitting or a service
    /// stopping without ever having connected, where it would overwrite a
    /// policy the user or an administrator set. `Down` means nothing of ours is
    /// engaged: every failed connect unwinds to `Error`, and `disconnect` is
    /// the only way back to `Down`.
    pub fn disconnect_if_active(&self) -> bool {
        let state = self.inner.lock().expect("tunnel mutex poisoned").state;
        if state == TunnelState::Down {
            return false;
        }
        let _ = self.disconnect();
        true
    }

    /// Tear the tunnel down: kill the sidecar and remove the kill switch.
    pub fn disconnect(&self) -> Result<TunnelStatus, TunnelError> {
        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");
        // DNS first, while the tunnel still runs: the system resolver is never
        // one that cannot be reached, and with the kill switch on, the original
        // resolver stays blocked until the switch itself comes down below.
        inner.restore_dns();
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
        // Remove split-tunneling bypass routes (include-mode tunnel routes are
        // interface-scoped and died with the sidecar above).
        let old_bypass = std::mem::take(&mut inner.bypass_routes);
        routing::remove_bypass_routes(&old_bypass);
        // Shut the wg-tls bridge (if any) down before we drop it below.
        if let Some(mut bridge) = inner.bridge.take() {
            bridge.shutdown();
        }
        let _ = killswitch::disengage(inner.backend);
        let backend = inner.backend;
        *inner = Inner {
            state: TunnelState::Down,
            endpoint: None,
            assigned_ip: None,
            country: None,
            local_src: None,
            error: None,
            sidecar: None,
            exit_sidecar: None,
            bridge: None,
            exit_ip: None,
            bypass_routes: Vec::new(),
            dns: None,
            backend,
            rx_bytes: 0,
            tx_bytes: 0,
            last_handshake: None,
            repaired_at: None,
        };
        Ok(inner.snapshot())
    }
}

#[cfg(test)]
mod roam_tests {
    use super::*;

    #[test]
    fn local_source_for_finds_a_route_to_a_public_address() {
        // No packet is sent — connect() only makes the kernel choose a route —
        // so this works offline-ish and never blocks. On a machine with any
        // route at all it must yield the source address that route would use.
        let src = local_source_for("1.1.1.1:51820");
        assert!(src.is_some(), "expected a source address for a routable IP");
        assert!(
            !src.unwrap().is_unspecified(),
            "0.0.0.0 is not a real source"
        );
    }

    #[test]
    fn local_source_for_rejects_anything_that_is_not_a_literal_endpoint() {
        // Parsed, never resolved: a hostname here would put DNS on the status
        // poll's path and could block the UI.
        assert!(local_source_for("gateway.example.com:51820").is_none());
        assert!(local_source_for("not-an-endpoint").is_none());
        assert!(local_source_for("").is_none());
    }

    #[test]
    fn local_source_for_handles_ipv6_endpoints() {
        // Must not panic or bind the v4 wildcard for a v6 endpoint.
        let _ = local_source_for("[2606:4700:4700::1111]:51820");
    }

    /// An `Inner` in the state the watchdog judges: up, with a handshake this
    /// many seconds old.
    fn up_with_handshake_age(age_secs: i64) -> Inner {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before the unix epoch")
            .as_secs() as i64;
        let mut inner = TunnelManager::new()
            .inner
            .into_inner()
            .expect("fresh mutex");
        inner.state = TunnelState::Up;
        inner.last_handshake = Some(now - age_secs);
        inner
    }

    /// A healthy tunnel's handshake age sawtooths up to ~120s between rekeys, so
    /// anything at or below that must read as alive — a watchdog that fires on
    /// the ordinary sawtooth would tear down working tunnels every two minutes.
    #[test]
    fn an_idle_but_rekeying_tunnel_is_not_dead() {
        assert!(!up_with_handshake_age(0).is_dead());
        assert!(!up_with_handshake_age(120).is_dead());
        assert!(!up_with_handshake_age(HANDSHAKE_DEAD_SEC).is_dead());
    }

    /// Past the threshold nothing has been received for over three minutes —
    /// the silent-roam / dead-gateway case that raises no error anywhere else.
    #[test]
    fn a_tunnel_past_the_threshold_is_dead() {
        assert!(up_with_handshake_age(HANDSHAKE_DEAD_SEC + 1).is_dead());
        assert!(up_with_handshake_age(3600).is_dead());
    }

    /// Coming up is not the same as dead. A tunnel that has never handshaken is
    /// the connect path's problem; firing here would abort every connection
    /// attempt before it finished.
    #[test]
    fn a_tunnel_that_has_never_handshaken_is_not_dead() {
        let mut inner = up_with_handshake_age(3600);
        inner.last_handshake = None;
        assert!(!inner.is_dead());
    }

    /// A repair is instant but the handshake proving it worked is up to a
    /// keepalive behind. Without the grace window a roam detected on an already
    /// stale tunnel would be repaired and then immediately torn down, turning a
    /// working seamless recovery into a visible reconnect.
    #[test]
    fn a_freshly_repaired_tunnel_is_shielded_from_the_watchdog() {
        let mut inner = up_with_handshake_age(3600);
        assert!(inner.is_dead(), "stale and unrepaired: dead");
        inner.repaired_at = Some(Instant::now());
        assert!(!inner.is_dead(), "just repaired: give it a chance");
        // ...but the shield expires, so a repair that did not take is still caught.
        inner.repaired_at = Some(Instant::now() - REPAIR_GRACE - Duration::from_secs(1));
        assert!(inner.is_dead(), "grace expired and still stale: dead");
    }

    /// Only an "up" tunnel can go stale; a down one is already handled, and
    /// re-flagging it would stomp the real error with a generic one.
    #[test]
    fn a_tunnel_that_is_not_up_is_never_dead() {
        for state in [
            TunnelState::Down,
            TunnelState::Connecting,
            TunnelState::Error,
        ] {
            let mut inner = up_with_handshake_age(3600);
            inner.state = state;
            assert!(!inner.is_dead(), "{state:?} must not be judged dead");
        }
    }
}
