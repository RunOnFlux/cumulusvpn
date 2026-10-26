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
//! A root app can also run it in-process: on macOS when launched as root, on
//! Linux when no daemon answers (an AppImage). On Windows it runs only in the
//! LocalSystem service; `ensure_privileged` refuses any other host up front
//! with that reason.
//!
//! Every host drives it the same way. They pass the wire-level requests from
//! `cumulusvpn-protocol` ([`TunnelManager::connect_request`],
//! [`TunnelManager::connect_multihop_request`]), which are shape-checked first
//! (`validate`) because on Linux and Windows the daemon's peers are less
//! trusted than a signed app; and they run [`spawn_repair_loop`] so that roam
//! repair and the dead-tunnel watchdog keep working when no UI is polling.

pub mod dns;
pub mod killswitch;
pub mod logfile;
pub mod routing;
pub mod tlsbridge;
mod validate;
pub mod wggo;
mod win;

use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use thiserror::Error;

pub use cumulusvpn_protocol::{
    ConnectRequest, MultihopEntryRequest, MultihopExitRequest, SplitParams, TlsParams, TunnelState,
    TunnelStatus,
};

use killswitch::Backend;
use wggo::{Sidecar, WgConfig};

/// `CREATE_NO_WINDOW` process-creation flag. The app is a GUI process, so every
/// child we spawn (netsh/route/powershell/wireguard-go) would otherwise flash a
/// console window on screen. Shared by the `wggo` and `routing` submodules.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Run `cmd` (already given `program` and `args`) to completion, logging to
/// stderr — the helper's log, or the app's in the in-process fallback — how
/// long it took, and on failure its exit status and output. [`TunnelError`]
/// carries a fixed message for the UI; this is where the real reason goes.
pub(crate) fn run_logged(
    cmd: &mut std::process::Command,
    program: &str,
    args: &[&str],
) -> std::io::Result<std::process::Output> {
    let started = Instant::now();
    let result = cmd.output();
    let ms = started.elapsed().as_millis();
    let line = args.join(" ");
    // The summary keeps the first 120 characters of a long command line.
    let short: String = line.chars().take(120).collect();
    match &result {
        Ok(out) if out.status.success() => {
            eprintln!("cumulusvpn-tunnel: `{program} {short}` ok in {ms} ms");
        }
        Ok(out) => eprintln!(
            "cumulusvpn-tunnel: `{program} {line}` failed ({}) in {ms} ms: stderr: {} | stdout: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim(),
            String::from_utf8_lossy(&out.stdout).trim(),
        ),
        Err(e) => eprintln!("cumulusvpn-tunnel: `{program}` could not be started: {e}"),
    }
    result
}

/// Fail fast unless this process can run the tunnel. On Windows that is
/// LocalSystem — the CumulusVPN Helper service: wireguard-go creates its UAPI
/// pipe owned by SYSTEM, which only a SYSTEM process may do, so any other host
/// (an elevated app, `cumulusvpn-helper --console`) is refused here, before
/// anything on the machine changes, with the reason.
#[cfg(windows)]
fn ensure_privileged() -> Result<(), TunnelError> {
    if win::process::is_local_system() {
        Ok(())
    } else {
        Err(TunnelError::Sidecar(
            "the tunnel runs only in the CumulusVPN Helper service (LocalSystem)",
        ))
    }
}

/// macOS and Linux need root. This code runs inside the root helper daemon, or
/// in an app that is itself root (the in-process mode); unprivileged, their
/// commands fail with "needs root" errors.
#[cfg(not(windows))]
fn ensure_privileged() -> Result<(), TunnelError> {
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
// Re-exported above for this crate's callers. The `Multihop*Params` stay
// here: they borrow, and never cross the wire.

/// Parameters for [`TunnelManager::connect_multihop_entry`]: the outer config
/// from core-ts `buildMultihopOuterConfig` plus the routing facts.
#[derive(Debug, Clone)]
pub struct MultihopEntryParams<'a> {
    /// ISO country of the ENTRY hop, reported in status while connecting.
    pub entry_country: &'a str,
    /// Outer `.conf` (wg-entry): `AllowedIPs = <exitIp>/32`, MTU 1420, no DNS.
    pub outer: &'a str,
    /// `<entryIp>:<port>` — the only real UDP egress; allow-listed by the switch.
    pub entry_endpoint: &'a str,
    /// `<exitIp>:51820` — host-routed via the outer interface.
    pub exit_endpoint: &'a str,
    /// Whether to engage the leak-protection kill switch for this session.
    pub kill_switch: bool,
    /// Compiled split-tunneling routes; their bypass prefixes are punched
    /// through the kill switch.
    pub split: Option<&'a SplitParams>,
}

/// Parameters for [`TunnelManager::connect_multihop_exit`]: the inner config
/// from core-ts `buildMultihopInnerConfig` plus the routing facts.
#[derive(Debug, Clone)]
pub struct MultihopExitParams<'a> {
    /// ISO country of the EXIT hop (the effective egress location).
    pub exit_country: &'a str,
    /// Inner `.conf` (wg-exit): `AllowedIPs = 0.0.0.0/0, ::/0`, MTU 1340, DNS.
    pub inner: &'a str,
    /// The entry step's `entry_endpoint`.
    pub entry_endpoint: &'a str,
    /// The entry step's `exit_endpoint`.
    pub exit_endpoint: &'a str,
    /// Inner interface MTU (1340).
    pub inner_mtu: u16,
    /// Inner (exit) assigned tunnel address, surfaced back in status.
    pub assigned_ip: &'a str,
    /// The entry step's `kill_switch`.
    pub kill_switch: bool,
    /// Compiled split-tunneling routes; `None`/empty = full tunnel. Applies to
    /// the inner (exit) device — that is where the default route lives (§7.2).
    pub split: Option<&'a SplitParams>,
}

/// The entry hop of a multi-hop session whose exit is not up yet: what the
/// exit step checks its request against.
struct EntryHop {
    /// The entry device's tunnel address; the exit's must differ.
    address: String,
    kill_switch: bool,
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
    /// Set by the multi-hop entry step, taken by the exit step.
    entry_hop: Option<EntryHop>,
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

/// Whether the kill switch needs the phase-2 re-engage once the tunnel devices
/// exist. macOS does (pf cannot name `utunN` up front) and so does Windows (WFP
/// names the adapter by its LUID, which exists only once wireguard-go has
/// created it): phase 1 blocks the tunnel, phase 2 passes it. Each re-engage is
/// one WFP transaction, milliseconds. Linux (nftables) allows the tun by the
/// `cvpn*` prefix in phase 1 and ignores `tun_interfaces`.
const KILL_SWITCH_NEEDS_TUN_PASS: bool = cfg!(any(target_os = "macos", windows));

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
        },
    )
}

/// The resolver(s) a parsed `.conf` names, typed, for the firewall rules.
fn dns_servers_of(config: &WgConfig) -> Vec<IpAddr> {
    config
        .dns
        .as_deref()
        .map(dns::parse_servers)
        .unwrap_or_default()
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

/// How many WFP filters the kill switch and the DNS leak block hold right now,
/// for `cumulusvpn-helper --filters` and the validation runbook.
#[cfg(windows)]
pub fn windows_filter_counts() -> Result<(usize, usize), String> {
    Ok((
        win::wfp::count(win::wfp::Sublayer::KillSwitch)?,
        win::wfp::count(win::wfp::Sublayer::Dns)?,
    ))
}

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

    /// The multi-hop entry step from its wire-level request. See
    /// [`Self::connect_request`].
    pub fn connect_multihop_entry_request(
        &self,
        r: &MultihopEntryRequest,
    ) -> Result<TunnelStatus, TunnelError> {
        validate::multihop_entry_request(r)?;
        self.connect_multihop_entry(&MultihopEntryParams {
            entry_country: &r.entry_country,
            outer: &r.outer,
            entry_endpoint: &r.entry_endpoint,
            exit_endpoint: &r.exit_endpoint,
            kill_switch: r.kill_switch,
            split: r.split.as_ref(),
        })
    }

    /// The multi-hop exit step from its wire-level request. See
    /// [`Self::connect_request`].
    pub fn connect_multihop_exit_request(
        &self,
        r: &MultihopExitRequest,
    ) -> Result<TunnelStatus, TunnelError> {
        validate::multihop_exit_request(r)?;
        self.connect_multihop_exit(&MultihopExitParams {
            exit_country: &r.exit_country,
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
                entry_hop: None,
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
        ensure_privileged()?;
        let mut config = WgConfig::parse(wg_config)?;
        let dns_servers = dns_servers_of(&config);
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
        inner.entry_hop = None;
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
        // place ahead of the first handshake rather than racing it. macOS and
        // Windows; on Linux the `cvpn*` prefix already covers the real name
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

    /// Multi-hop (`docs/11-multihop.md`), step 1 of 2: bring the ENTRY hop up
    /// and route the exit gateway's IP through it.
    ///
    /// After this, every packet to the exit gateway — the client's enroll at
    /// the exit included — leaves inside the entry tunnel, so the exit never
    /// sees the client's real address. Engages the kill switch on the entry
    /// endpoint (the only real UDP egress), spawns + configures the outer
    /// device from `outer`, pins the entry endpoint to the physical gateway and
    /// `<exitIp>/32` to the outer device. The state stays `Connecting` until
    /// [`Self::connect_multihop_exit`]. Replaces any existing session; any
    /// failure tears down everything set up so far.
    pub fn connect_multihop_entry(
        &self,
        params: &MultihopEntryParams<'_>,
    ) -> Result<TunnelStatus, TunnelError> {
        ensure_privileged()?;
        let outer_cfg = WgConfig::parse(params.outer)?;
        let exit_ip = strip_endpoint_port(params.exit_endpoint).to_string();
        let entry_ip = strip_endpoint_port(params.entry_endpoint).to_string();

        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");

        // Replace any existing tunnel (single-hop or a prior multi-hop pair).
        // Reachable via reconnect without a disconnect(), so clear the previous
        // session's leak-protection state fully (see connect()).
        inner.restore_dns();
        inner.entry_hop = None;
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

        inner.state = TunnelState::Connecting;
        inner.country = Some(params.entry_country.to_string());
        // The entry endpoint is the wire endpoint (what actually leaves the host).
        inner.endpoint = Some(params.entry_endpoint.to_string());
        inner.assigned_ip = None;
        inner.error = None;

        // Kill switch allow-lists the entry endpoint only — the exit is reached
        // *through* the entry tunnel, never directly from the host. No resolver
        // yet: the exit step brings DNS. Split bypass prefixes are punched
        // through here too — the compile step already rejects prefixes
        // containing the entry/exit endpoints, so the bypass can never shadow
        // the entry allowance (§7.2). Off → tear down any ruleset a prior
        // session left engaged (see connect()).
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
                    dns_servers: &[],
                },
            )
            .map_err(|_| TunnelError::KillSwitch("failed to engage"))?;
        } else {
            let _ = killswitch::disengage(inner.backend);
        }

        // Unwind everything set up so far on any failure.
        let fail = |inner: &mut Inner,
                    entry_sc: Option<Sidecar>,
                    routed: bool,
                    e: TunnelError|
         -> Result<TunnelStatus, TunnelError> {
            if routed {
                let _ = routing::clear_multihop_routes(&exit_ip);
            }
            // Best-effort: the entry bypass may or may not have been installed.
            routing::remove_endpoint_bypass(&entry_ip);
            if let Some(sc) = entry_sc {
                let _ = sc.kill();
            }
            let _ = killswitch::disengage(inner.backend);
            inner.state = TunnelState::Error;
            inner.error = Some(e.to_string());
            Err(e)
        };

        let entry_sidecar = match Sidecar::spawn(IFACE_ENTRY) {
            Ok(s) => s,
            Err(e) => return fail(&mut inner, None, false, e),
        };
        // Phase 2a: allow the entry tun — it carries everything sent to the
        // exit gateway, the exit's handshake and the enroll at the exit
        // included. macOS and Windows (`KILL_SWITCH_NEEDS_TUN_PASS`).
        if params.kill_switch && KILL_SWITCH_NEEDS_TUN_PASS {
            let tuns = [entry_sidecar.interface.clone()];
            if let Err(e) = engage_with_tuns(
                inner.backend,
                params.entry_endpoint,
                IFACE_ENTRY,
                killswitch::Proto::Udp,
                split_bypass,
                &tuns,
                &[],
            ) {
                return fail(&mut inner, Some(entry_sidecar), false, e);
            }
        }
        if let Err(e) = entry_sidecar.configure(&outer_cfg) {
            return fail(&mut inner, Some(entry_sidecar), false, e);
        }

        // Routes. Use the *real* kernel-assigned device name (utunN on macOS),
        // not the logical IFACE_* label, since that is what the routing table
        // keys on.
        let entry_if = entry_sidecar.interface.clone();

        // Pin the entry endpoint to the physical gateway so the outer tunnel's
        // own UDP escapes (same bypass as single-hop, on the entry endpoint).
        if let Err(e) = routing::add_endpoint_bypass(&entry_ip) {
            return fail(&mut inner, Some(entry_sidecar), false, e);
        }
        // Pin the exit gateway through the entry tunnel: every packet to it
        // must leave inside the entry tunnel — never from the real address.
        if let Err(e) = routing::add_host_route(&exit_ip, &entry_if) {
            return fail(&mut inner, Some(entry_sidecar), false, e);
        }
        eprintln!("cumulusvpn-tunnel: exit gateway {exit_ip} pinned to {entry_if}");

        inner.sidecar = Some(entry_sidecar);
        inner.exit_ip = Some(exit_ip);
        inner.entry_hop = Some(EntryHop {
            address: outer_cfg.address,
            kill_switch: params.kill_switch,
        });
        Ok(inner.snapshot())
    }

    /// Multi-hop, step 2 of 2: bring the EXIT hop up through the entry hop
    /// [`Self::connect_multihop_entry`] left `Connecting`, then route all
    /// traffic and DNS to it.
    ///
    /// Refuses unless that entry step is pending for the same entry and exit
    /// endpoints and kill-switch choice, and unless the exit's tunnel address
    /// differs from the entry's (two interfaces, one address each). Spawns +
    /// configures the inner device from `inner`, installs the default route
    /// (or the split routes) on it, and applies DNS last. Any failure, a
    /// refusal included, tears the whole session down.
    pub fn connect_multihop_exit(
        &self,
        params: &MultihopExitParams<'_>,
    ) -> Result<TunnelStatus, TunnelError> {
        ensure_privileged()?;
        let inner_cfg = WgConfig::parse(params.inner)?;
        // DNS belongs to the inner (exit) device: that is where the default
        // route, and so the resolver's traffic, goes.
        let dns_servers = dns_servers_of(&inner_cfg);
        let exit_ip = strip_endpoint_port(params.exit_endpoint).to_string();
        let entry_ip = strip_endpoint_port(params.entry_endpoint).to_string();
        let split_bypass: &[String] = params
            .split
            .map(|s| s.bypass_routes.as_slice())
            .unwrap_or(&[]);
        let split_tunnel: &[String] = params
            .split
            .map(|s| s.tunnel_routes.as_slice())
            .unwrap_or(&[]);

        let mut inner = self.inner.lock().expect("tunnel mutex poisoned");

        // Unwind the whole session on any failure.
        let fail = |inner: &mut Inner,
                    exit_sc: Option<Sidecar>,
                    e: TunnelError|
         -> Result<TunnelStatus, TunnelError> {
            if let Some(ip) = inner.exit_ip.take() {
                let _ = routing::clear_multihop_routes(&ip);
            }
            if let Some(ep) = inner.endpoint.as_deref() {
                routing::remove_endpoint_bypass(strip_endpoint_port(ep));
            }
            let bypass = std::mem::take(&mut inner.bypass_routes);
            routing::remove_bypass_routes(&bypass);
            if let Some(sc) = exit_sc {
                let _ = sc.kill();
            }
            if let Some(sc) = inner.sidecar.take() {
                let _ = sc.kill();
            }
            inner.entry_hop = None;
            let _ = killswitch::disengage(inner.backend);
            inner.state = TunnelState::Error;
            inner.error = Some(e.to_string());
            Err(e)
        };

        let pending = inner.entry_hop.take();
        let matches = inner.state == TunnelState::Connecting
            && inner.sidecar.is_some()
            && inner.endpoint.as_deref() == Some(params.entry_endpoint)
            && inner.exit_ip.as_deref() == Some(exit_ip.as_str());
        let Some(hop) = pending.filter(|h| matches && h.kill_switch == params.kill_switch) else {
            eprintln!(
                "cumulusvpn-tunnel: connect_multihop_exit refused: no entry hop up for {} -> {exit_ip}",
                params.entry_endpoint
            );
            return fail(
                &mut inner,
                None,
                TunnelError::BadConfig("no matching multi-hop entry hop is up"),
            );
        };
        // The two devices are separate interfaces, and an address belongs to one
        // interface: the pair needs distinct tunnel addresses.
        if hop.address == inner_cfg.address {
            eprintln!(
                "cumulusvpn-tunnel: connect_multihop_exit refused: entry and exit both assigned {}",
                hop.address
            );
            return fail(
                &mut inner,
                None,
                TunnelError::BadConfig("entry and exit hops assigned the same tunnel address"),
            );
        }
        let entry_if = inner
            .sidecar
            .as_ref()
            .map(|sc| sc.interface.clone())
            .expect("checked above");

        let exit_sidecar = match Sidecar::spawn(IFACE_EXIT) {
            Ok(s) => s,
            Err(e) => return fail(&mut inner, None, e),
        };
        // Phase 2b: both devices known, and the resolvers. macOS and Windows
        // (`KILL_SWITCH_NEEDS_TUN_PASS`).
        if params.kill_switch && KILL_SWITCH_NEEDS_TUN_PASS {
            let tuns = [entry_if, exit_sidecar.interface.clone()];
            if let Err(e) = engage_with_tuns(
                inner.backend,
                params.entry_endpoint,
                IFACE_ENTRY,
                killswitch::Proto::Udp,
                split_bypass,
                &tuns,
                &dns_servers,
            ) {
                return fail(&mut inner, Some(exit_sidecar), e);
            }
        }
        if let Err(e) = exit_sidecar.configure(&inner_cfg) {
            return fail(&mut inner, Some(exit_sidecar), e);
        }
        let exit_if = exit_sidecar.interface.clone();

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
            return fail(&mut inner, Some(exit_sidecar), e);
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
            endpoint_ips,
            pin_route: params.split.is_some(),
            kill_switch: params.kill_switch,
        }));

        inner.exit_sidecar = Some(exit_sidecar);
        inner.country = Some(params.exit_country.to_string());
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
    /// routes through them, go with them), on Windows the routes on the
    /// physical interface listed in the route record (`win::net`), and the
    /// kill switch. Linux and Windows call this once at startup — the helper
    /// daemon, and the elevated in-process app — before anything can connect.
    ///
    /// Why the kill switch too: at startup there is no session to protect. The
    /// sidecar that carried the tunnel is dead (systemd kills the service's
    /// cgroup; on Windows it is reaped here), so the rules can only block, and
    /// the process that knew to lift them is gone. If the app is running it
    /// sees the drop and reconnects, which re-engages the switch for the new
    /// session.
    ///
    /// Order mirrors [`Self::disconnect`]: DNS first, then the devices and
    /// routes, the kill switch last. Each step acts only on what is ours (our
    /// nft table, our WFP sublayers, our recorded routes, sidecars started from
    /// our own binary for our interface names) and is a no-op when none is there.
    /// Like [`Self::recover_stale_dns`], a no-op if this manager has a session.
    pub fn recover_stale(&self) {
        let inner = self.inner.lock().expect("tunnel mutex poisoned");
        if inner.state != TunnelState::Down || inner.dns.is_some() {
            return;
        }
        dns::recover_stale(&[IFACE, IFACE_EXIT]);
        wggo::reap_orphans(&[IFACE, IFACE_ENTRY, IFACE_EXIT]);
        #[cfg(windows)]
        win::net::recover_stale();
        killswitch::recover_stale(inner.backend);
    }

    /// Tear down only if something is up. Returns whether it did.
    ///
    /// The quit and stop paths use this; [`Self::disconnect`] is unconditional
    /// by design: it lifts the kill switch whether or not we engaged anything,
    /// which on macOS reloads the main pf ruleset from `/etc/pf.conf`. That is
    /// right for an explicit Disconnect; an app quitting or a service stopping
    /// without ever having connected leaves the firewall as it found it.
    /// `Down` means nothing of ours is engaged: every failed connect unwinds to
    /// `Error`, and `disconnect` is the only way back to `Down`.
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
            entry_hop: None,
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

#[cfg(test)]
mod dns_servers_tests {
    use super::*;

    const KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    fn conf(dns: &str) -> WgConfig {
        WgConfig::parse(&format!(
            "[Interface]\nPrivateKey = {KEY}\nAddress = 10.8.0.2/32\nDNS = {dns}\n\n\
             [Peer]\nPublicKey = {KEY}\nEndpoint = 203.0.113.7:51820\nAllowedIPs = 0.0.0.0/0\n"
        ))
        .expect("parse")
    }

    /// What a connect hands the kill switch and the DNS session: EVERY resolver
    /// on the `.conf` line, in order — for the default as for a Settings → DNS
    /// provider.
    #[test]
    fn every_resolver_on_the_dns_line_reaches_the_leak_protection() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        assert_eq!(dns_servers_of(&conf("1.1.1.1")), vec![ip("1.1.1.1")]);
        assert_eq!(
            dns_servers_of(&conf("9.9.9.9, 149.112.112.112")),
            vec![ip("9.9.9.9"), ip("149.112.112.112")]
        );
        assert_eq!(
            dns_servers_of(&conf("94.140.14.14,94.140.15.15")),
            vec![ip("94.140.14.14"), ip("94.140.15.15")]
        );
    }

    /// A multi-hop outer `.conf` carries no DNS line: no resolvers, so nothing
    /// is allowed on its account.
    #[test]
    fn no_dns_line_means_no_resolvers() {
        let outer = WgConfig::parse(&format!(
            "[Interface]\nPrivateKey = {KEY}\nAddress = 10.8.0.2/32\nMTU = 1420\n\n\
             [Peer]\nPublicKey = {KEY}\nEndpoint = 203.0.113.7:51820\nAllowedIPs = 198.51.100.9/32\n"
        ))
        .expect("parse");
        assert!(dns_servers_of(&outer).is_empty());
    }
}
