//! Kill switch — platform firewall rules that block all non-tunnel traffic so
//! nothing leaks if the WireGuard handshake drops.
//!
//! The policy is identical everywhere: allow loopback, allow the WireGuard
//! endpoint (UDP on the transport's port — 51820 vanilla, 51821 for the
//! obfuscated `awg` transport), the gateway's control API on the endpoint's
//! address (TCP [`GATEWAY_CONTROL_PORT`]) and the tunnel, drop the rest of the
//! plaintext egress. The port is parsed from the endpoint we're handed, not hardcoded, so
//! Stealth (awg on 51821) isn't dropped by the kill switch.
//! Only the mechanism differs per OS — pf (macOS), nftables (Linux), and
//! Windows Filtering Platform filters in our own sublayer (Windows, called
//! natively through `super::win`).
//!
//! **Timing.** `engage` is called *before* the wireguard-go sidecars spawn, so
//! the switch is closed from the very start, ahead of the tunnel device:
//!   - **Linux** wireguard-go uses the logical interface name, so we allow it
//!     by the `cvpn*` prefix (covers `cvpn0`, `cvpn-entry`, `cvpn-exit`).
//!   - **macOS and Windows** name the device once it exists (the `utunN` name;
//!     the adapter's LUID), so `engage` runs in two phases. Phase 1 (before the
//!     sidecar) blocks all egress but loopback, the endpoint and its control API. Phase 2
//!     re-engages with the real devices once `Sidecar::spawn` has created them,
//!     adding the pass that lets tunnel traffic out.
//!
//! **The block covers every interface.** Each backend is a default-drop policy
//! plus explicit passes — Linux `policy drop`, a weight-0 block in our WFP
//! sublayer on Windows — so the switch holds across Wi-Fi changes, tethering
//! and dock/undock, whichever interface carries traffic.
//!
//! **DNS is blocked too, except to the tunnel resolvers through the tunnel.**
//! Every backend drops UDP+TCP 53/853 unless it goes to one of the session's
//! resolvers (`LeakPolicy::dns_servers` — every address on the `.conf`'s
//! `DNS =` line, whichever provider the user picked) out of a tunnel device,
//! and that drop is placed *before* the split-bypass / LAN passes. Otherwise a
//! LAN-allow (`192.168.0.0/16`) would quietly reopen DNS to the router, and with
//! it every name the user looks up. It has no address family, so IPv6 resolvers
//! on the physical link (RDNSS, link-local) are dropped as well — the tunnel
//! carries no IPv6. The WireGuard endpoint pass stays ahead of it, so a
//! transport on port 53 would still work.
//! On Windows the order is the filter weight (`win::plan::kill_switch_plan`).
//! 853 is DNS over TLS / QUIC; DNS over HTTPS is HTTPS on 443 and rides the
//! tunnel like any other HTTPS.
//!
//! **Self-contained + removable.** Everything lives in a dedicated scope — a pf
//! anchor (`com.cumulusvpn`), an nftables table (`inet cumulusvpn`), or a WFP
//! sublayer under our own GUID — and [`disengage`] removes exactly that scope.
//! macOS also replaces the main ruleset while connected and restores it on
//! teardown. Windows filters last until removed or until the next boot, so
//! every boot, including after a power cut while connected, starts unblocked.
//!
//! **Privilege + lifecycle.** `pfctl`/`nft` and WFP need root/Admin, so
//! they run inside the privileged helper daemon (a LaunchDaemon on macOS, a
//! systemd service on Linux, a LocalSystem service on Windows). The daemon
//! outlives the app: a clean quit disengages (the app disconnects on exit), and
//! an app that is killed outright leaves the tunnel and its switch running in
//! the daemon, with the daemon's repair loop still tending them. Stopping the
//! Linux / Windows service disconnects first. A daemon that itself died
//! mid-session leaves the block engaged (fail-closed); on Linux and Windows the
//! next daemon start lifts it with [`recover_stale`] before serving anyone,
//! while macOS keeps it until the app reconnects. In the elevated in-process
//! fallback (no daemon) the app plays the daemon's part, startup recovery
//! included, but a killed app strands the block until it is relaunched.

#[cfg(unix)]
use std::io::Write;
#[cfg(unix)]
use std::process::Command;
#[cfg(unix)]
use std::process::Stdio;

use std::net::IpAddr;

use super::TunnelError;

/// pf anchor (macOS) / nft table (Linux) name — our dedicated, removable
/// scope. Windows uses its own WFP sublayer (`win::wfp::Sublayer::KillSwitch`).
#[cfg(target_os = "macos")]
const ANCHOR: &str = "com.cumulusvpn";
// Always compiled: `linux_nft_table` is pure and tested from every host.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const TABLE: &str = "cumulusvpn";

/// The gateway's control API port (TCP; `docs/10-api-contract.md`). Every
/// backend allows TCP to it on the endpoint's address alongside the WireGuard
/// endpoint itself: the endpoint pin routes all traffic for that address out
/// the physical interface, so the app's entitlement and status requests to its
/// gateway take that path while connected. The replies are signed and verified
/// by the app.
pub const GATEWAY_CONTROL_PORT: u16 = 51821;

/// Where the leak-protection rules get installed, per platform.
#[derive(Debug, Clone, Copy)]
pub enum Backend {
    /// macOS packet filter (`pf` via `pfctl` + an anchor).
    MacosPf,
    /// Linux netfilter (`nftables`).
    LinuxNftables,
    /// Windows Filtering Platform: filters in our own sublayer.
    WindowsWfp,
}

/// Transport protocol of the WireGuard endpoint the kill switch must permit.
/// Vanilla / awg dial the gateway over UDP; the wg-tls transport dials the TLS
/// relay over TCP (the local UDP side is loopback, always allowed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Proto {
    Udp,
    Tcp,
}

impl Proto {
    /// pf (macOS) / nftables (Linux) spelling — both use lowercase `udp`/`tcp`.
    fn pf_nft(self) -> &'static str {
        match self {
            Proto::Udp => "udp",
            Proto::Tcp => "tcp",
        }
    }
}

/// Detect the firewall backend for the current OS at runtime.
pub fn detect_backend() -> Backend {
    #[cfg(target_os = "macos")]
    {
        Backend::MacosPf
    }
    #[cfg(target_os = "windows")]
    {
        Backend::WindowsWfp
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Backend::LinuxNftables
    }
}

/// What the kill switch must allow while blocking everything else
/// (docs/17-split-tunneling.md §7.1).
///
/// Split tunneling and the kill switch compose here: every user exclusion must
/// punch a matching hole or split tunneling silently does nothing while
/// appearing configured — the failure mode that fails in the "user thinks it
/// works" direction. `bypass_cidrs` comes from the compiled split policy
/// (core-ts `CompiledSplit.bypassRoutes`), already merged and canonical.
///
/// Include mode ("only these through the VPN") is incompatible with the kill
/// switch by construction — its default is direct egress, which is exactly what
/// the switch blocks. The UI enforces that mutual exclusion; this layer only
/// ever sees exclude-direction bypass prefixes.
#[derive(Debug, Clone)]
pub struct LeakPolicy<'a> {
    /// `<ip>:<port>` the WireGuard sidecar will dial (gateway or TLS relay).
    pub endpoint: &'a str,
    /// Logical tunnel interface label (see module docs on naming).
    pub interface: &'a str,
    /// The **real** kernel tun names (`utun6`, `cvpn0`), once known. Empty on the
    /// phase-1 engage that runs before the sidecar exists. macOS passes them by
    /// name and Windows by their adapters' LUIDs; Linux matches the tun by the
    /// `cvpn*` prefix, which is the real name there, so it ignores this field.
    pub tun_interfaces: &'a [String],
    /// UDP for vanilla/awg, TCP for the wg-tls relay connection.
    pub proto: Proto,
    /// Prefixes allowed to egress on the physical interface (user exclusions +
    /// LAN bypass, from the compiled split policy). Empty → classic behaviour.
    pub bypass_cidrs: &'a [String],
    /// Platform app identities allowed to egress directly, where the backend
    /// can express it (pf group, nft cgroup, WFP app id). Unused until desktop
    /// app rules ship (docs/17 §12 Phase 4); kept in the signature so that
    /// phase does not need another breaking change here.
    pub bypass_apps: &'a [String],
    /// The tunnel's resolver(s) — the only DNS (UDP/TCP 53 and 853) allowed out,
    /// and only through a tunnel device. Empty → all DNS is dropped. Typed, so
    /// nothing but an address reaches the rule text.
    pub dns_servers: &'a [IpAddr],
}

/// A prefix is interpolated into firewall rule text, so it must never carry
/// anything but address characters — same defense-in-depth as the port parse.
fn is_safe_cidr(cidr: &str) -> bool {
    !cidr.is_empty()
        && cidr
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'.' || b == b':' || b == b'/')
}

/// An interface name is interpolated into rule text, so it must never carry
/// anything but name characters — same defense-in-depth as `is_safe_cidr`.
fn is_safe_iface(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// Engage the kill switch: permit loopback, the tunnel, the exact endpoint
/// we're about to hand to wireguard-go, and the policy's bypass prefixes; drop
/// everything else. Idempotent — re-engaging replaces the rule set.
///
/// `policy.interface` is the *logical* label (the real tun name isn't known yet
/// — see the module docs); the rules match the tun by prefix (Linux/Windows) or
/// ignore it and block on the physical (macOS).
pub fn engage(backend: Backend, policy: &LeakPolicy<'_>) -> Result<(), TunnelError> {
    let _ = policy.interface;
    let _ = policy.bypass_apps; // Phase 4 (desktop app rules)
    if !policy.bypass_cidrs.iter().all(|c| is_safe_cidr(c)) {
        return Err(TunnelError::KillSwitch("invalid bypass prefix"));
    }
    if !policy.tun_interfaces.iter().all(|i| is_safe_iface(i)) {
        return Err(TunnelError::KillSwitch("invalid tunnel interface name"));
    }
    let (endpoint_ip, endpoint_port) = split_endpoint(policy.endpoint);
    match backend {
        #[cfg(target_os = "macos")]
        Backend::MacosPf => engage_macos(
            endpoint_ip,
            endpoint_port,
            policy.proto,
            policy.bypass_cidrs,
            policy.tun_interfaces,
            policy.dns_servers,
        ),
        #[cfg(target_os = "linux")]
        Backend::LinuxNftables => engage_linux(
            endpoint_ip,
            endpoint_port,
            policy.proto,
            policy.bypass_cidrs,
            policy.dns_servers,
        ),
        #[cfg(target_os = "windows")]
        Backend::WindowsWfp => engage_windows(
            endpoint_ip,
            endpoint_port,
            policy.proto,
            policy.bypass_cidrs,
            policy.tun_interfaces,
            policy.dns_servers,
        ),
        // A backend that isn't native to this build: seam.
        #[allow(unreachable_patterns)]
        _ => {
            let _ = (endpoint_ip, endpoint_port);
            Ok(())
        }
    }
}

/// Remove all kill-switch rules and restore normal traffic. Best-effort: on
/// error we log but still tear the tunnel down, so the user is never left with a
/// half-applied firewall we can silently fail to clear.
pub fn disengage(backend: Backend) -> Result<(), TunnelError> {
    match backend {
        #[cfg(target_os = "macos")]
        Backend::MacosPf => disengage_macos(),
        #[cfg(target_os = "linux")]
        Backend::LinuxNftables => disengage_linux(),
        #[cfg(target_os = "windows")]
        Backend::WindowsWfp => disengage_windows(),
        #[allow(unreachable_patterns)]
        _ => {}
    }
    Ok(())
}

/// Lift a kill switch left engaged by a host that died mid-session, and only
/// if one is actually there. Called at startup by the Linux / Windows helper
/// daemon and the in-process app (`TunnelManager::recover_stale`), never while
/// a session of ours exists.
///
/// Every daemon start runs it, including the first boot after install, and it
/// acts only on our own scope: Linux deletes our nft table (a no-op when
/// absent); Windows clears our WFP sublayer and removes the `CumulusVPN` /
/// `CumulusVPN-DNS` Windows Firewall rule groups where they exist
/// (`win::legacy`).
///
/// macOS does nothing here on purpose: pf state never survives a reboot, and a
/// helper restarted by launchd keeps the previous instance's fail-closed anchor
/// until the app reconnects (row H15); the macOS helper does not call this.
pub fn recover_stale(backend: Backend) {
    match backend {
        #[cfg(target_os = "linux")]
        Backend::LinuxNftables => disengage_linux(),
        #[cfg(target_os = "windows")]
        Backend::WindowsWfp => {
            disengage_windows();
            crate::win::legacy::clean_up();
        }
        #[allow(unreachable_patterns)]
        _ => {}
    }
}

/// The vanilla WireGuard port — the fallback when an endpoint carries no `:port`.
const DEFAULT_WG_PORT: &str = "51820";

/// Split an `ip:port` endpoint into `(host, port)` (our gateways are IPv4, so a
/// single rsplit is safe). A missing port defaults to the vanilla WG port; a
/// non-numeric port is rejected (defense-in-depth — the port is interpolated
/// into firewall rules, so it must never carry anything but digits) and also
/// falls back to the default with the bad port stripped from the host.
fn split_endpoint(endpoint: &str) -> (&str, &str) {
    match endpoint.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => {
            (host, port)
        }
        _ => (strip_port(endpoint), DEFAULT_WG_PORT),
    }
}

/// Strip a trailing `:port` from an `ip:port` endpoint (our gateways are IPv4, so
/// a single rsplit is safe). Returns the input unchanged if there is no port.
fn strip_port(endpoint: &str) -> &str {
    endpoint
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(endpoint)
}

// ---- macOS (pf) ------------------------------------------------------------

/// Build the pf anchor rule text.
///
/// Pure and always compiled (not `cfg(macos)`) so the ruleset this whole
/// security property rests on can be asserted on in tests from any host — CI
/// runs on Linux, where nothing else would exercise it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn macos_anchor_rules(
    endpoint_ip: &str,
    endpoint_port: &str,
    proto: Proto,
    bypass_cidrs: &[String],
    tun_interfaces: &[String],
    dns_servers: &[IpAddr],
) -> String {
    let proto_s = proto.pf_nft();
    // Our anchor, in pf evaluation order (first matching `quick` rule wins, and
    // the unqualified block is the catch-all):
    //
    //   1. loopback — always (local resolvers, mDNSResponder's own sockets);
    //   2. the exact WireGuard endpoint, so the tunnel's own UDP/TCP escapes —
    //      ahead of the DNS block, so a transport on port 53 is never caught —
    //      and the gateway's control API (TCP `GATEWAY_CONTROL_PORT`);
    //   3. DNS to the tunnel resolver, through a tunnel device (phase 2 only);
    //   4. every other DNS packet, on any interface, to anyone: dropped. This
    //      precedes the tunnel and bypass passes, so neither DNS to another
    //      server through the tunnel nor DNS to the router via a LAN bypass
    //      gets out;
    //   5. the tunnel devices, once we know their names (phase 2). Before that
    //      the list is empty and nothing is moving through a tun yet;
    //   6. every split-tunneling bypass prefix (all protocols — a bypassed
    //      destination is fully direct, except for DNS above);
    //   7. drop everything else.
    //
    // Note what is deliberately absent from every block: an interface. Scoping
    // any of this to the physical NIC would fail open on the first roam (see the
    // module docs). And no address family: the DNS block covers IPv6 resolvers
    // on the physical link too. `proto` is udp for vanilla/awg, tcp for wg-tls.
    let resolvers = dns_servers
        .iter()
        .map(IpAddr::to_string)
        .collect::<Vec<_>>()
        .join(" ");
    let tun_dns_rules: String = if dns_servers.is_empty() {
        String::new()
    } else {
        tun_interfaces
            .iter()
            .map(|tun| {
                format!(
                    "pass out quick on {tun} proto {{ udp tcp }} to {{ {resolvers} }} \
                     port {{ 53 853 }} keep state\n"
                )
            })
            .collect()
    };
    let tun_rules: String = tun_interfaces
        .iter()
        .map(|tun| format!("pass out quick on {tun} all\n"))
        .collect();
    let bypass_rules: String = bypass_cidrs
        .iter()
        .map(|cidr| format!("pass out quick to {cidr} keep state\n"))
        .collect();
    format!(
        "pass quick on lo0 all\n\
         pass out quick proto {proto_s} to {endpoint_ip} port {endpoint_port} keep state\n\
         pass out quick proto tcp to {endpoint_ip} port {GATEWAY_CONTROL_PORT} keep state\n\
         {tun_dns_rules}\
         block drop out quick proto {{ udp tcp }} to any port {{ 53 853 }}\n\
         {tun_rules}\
         {bypass_rules}\
         block drop out all\n"
    )
}

#[cfg(target_os = "macos")]
fn engage_macos(
    endpoint_ip: &str,
    endpoint_port: &str,
    proto: Proto,
    bypass_cidrs: &[String],
    tun_interfaces: &[String],
    dns_servers: &[IpAddr],
) -> Result<(), TunnelError> {
    let anchor_rules = macos_anchor_rules(
        endpoint_ip,
        endpoint_port,
        proto,
        bypass_cidrs,
        tun_interfaces,
        dns_servers,
    );
    run_stdin(
        "pfctl",
        &["-a", ANCHOR, "-f", "-"],
        &anchor_rules,
        "failed to load kill-switch anchor",
    )?;

    // Main ruleset: keep Apple's default anchors, then evaluate ours. This owns
    // pf's main ruleset while connected; disengage restores /etc/pf.conf.
    let main_rules = format!(
        "scrub-anchor \"com.apple/*\"\n\
         nat-anchor \"com.apple/*\"\n\
         rdr-anchor \"com.apple/*\"\n\
         dummynet-anchor \"com.apple/*\"\n\
         anchor \"com.apple/*\"\n\
         load anchor \"com.apple\" from \"/etc/pf.anchors/com.apple\"\n\
         anchor \"{ANCHOR}\"\n"
    );
    run_stdin(
        "pfctl",
        &["-f", "-"],
        &main_rules,
        "failed to load kill-switch ruleset",
    )?;

    // Enable pf (harmless if already enabled).
    run_best_effort("pfctl", &["-e"]);
    Ok(())
}

#[cfg(target_os = "macos")]
fn disengage_macos() {
    run_best_effort("pfctl", &["-a", ANCHOR, "-F", "all"]); // flush our anchor
    run_best_effort("pfctl", &["-f", "/etc/pf.conf"]); // restore the default ruleset
                                                       // Leave pf enabled per /etc/pf.conf; do not force-disable (the system may
                                                       // rely on it).
}

// ---- Linux (nftables) ------------------------------------------------------

/// Build the nftables table text. Pure and always compiled, like
/// [`macos_anchor_rules`], so the Linux ruleset is asserted on from any host.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_nft_table(
    endpoint_ip: &str,
    endpoint_port: &str,
    proto: Proto,
    bypass_cidrs: &[String],
    dns_servers: &[IpAddr],
) -> String {
    let proto_s = proto.pf_nft();
    // Split-tunneling bypass prefixes: allowed out on any interface, any
    // protocol — the routing table (not the firewall) decides where they go.
    let bypass_rules: String = bypass_cidrs
        .iter()
        .map(|cidr| {
            let family = if cidr.contains(':') { "ip6" } else { "ip" };
            format!("\t\t{family} daddr {cidr} accept\n")
        })
        .collect();
    // DNS to the tunnel resolver(s), only out of a tunnel device. One rule per
    // family and transport; `udp dport` / `tcp dport` rather than `th dport`
    // for older nft.
    let mut dns_allow = String::new();
    for (family, servers) in [
        (
            "ip",
            dns_servers
                .iter()
                .filter(|s| s.is_ipv4())
                .collect::<Vec<_>>(),
        ),
        (
            "ip6",
            dns_servers
                .iter()
                .filter(|s| s.is_ipv6())
                .collect::<Vec<_>>(),
        ),
    ] {
        if servers.is_empty() {
            continue;
        }
        let set = servers
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        for l4 in ["udp", "tcp"] {
            dns_allow.push_str(&format!(
                "\t\toifname \"cvpn*\" {family} daddr {{ {set} }} {l4} dport {{ 53, 853 }} accept\n"
            ));
        }
    }
    // A dedicated inet table with a default-drop output chain: allow loopback,
    // the WireGuard endpoint handshake/data (the endpoint rule matches every
    // packet to the gateway, so no conntrack exemption is needed) and the
    // gateway's control API (TCP `GATEWAY_CONTROL_PORT`), DNS to the
    // tunnel resolver through the tunnel, then drop all other DNS before the
    // tunnel devices (cvpn* — logical names on Linux) and the bypass prefixes
    // are allowed; drop the rest. The inet table covers IPv4 and IPv6, so the
    // DNS drop also catches a v6 resolver on the physical link. `proto` is udp
    // for vanilla/awg, tcp for the wg-tls relay connection.
    //
    // Deliberately NO `ct state established,related accept`: that would let every
    // connection open on the physical NIC *before* the tunnel came up keep
    // egressing in plaintext outside the tunnel — a leak, and it's not needed for
    // WireGuard (covered by the endpoint rule). This matches the fail-closed macOS
    // pf ruleset (block all on the physical except loopback + endpoint).
    format!(
        "table inet {TABLE} {{\n\
         \tchain output {{\n\
         \t\ttype filter hook output priority 0; policy drop;\n\
         \t\toifname \"lo\" accept\n\
         \t\tip daddr {endpoint_ip} {proto_s} dport {endpoint_port} accept\n\
         \t\tip daddr {endpoint_ip} tcp dport {GATEWAY_CONTROL_PORT} accept\n\
         {dns_allow}\
         \t\tudp dport {{ 53, 853 }} drop\n\
         \t\ttcp dport {{ 53, 853 }} drop\n\
         \t\toifname \"cvpn*\" accept\n\
         {bypass_rules}\
         \t}}\n\
         }}\n"
    )
}

#[cfg(target_os = "linux")]
fn engage_linux(
    endpoint_ip: &str,
    endpoint_port: &str,
    proto: Proto,
    bypass_cidrs: &[String],
    dns_servers: &[IpAddr],
) -> Result<(), TunnelError> {
    let table = linux_nft_table(endpoint_ip, endpoint_port, proto, bypass_cidrs, dns_servers);
    // Replace any prior instance.
    run_best_effort("nft", &["delete", "table", "inet", TABLE]);
    run_stdin(
        "nft",
        &["-f", "-"],
        &table,
        "failed to load nftables kill switch",
    )
}

#[cfg(target_os = "linux")]
fn disengage_linux() {
    run_best_effort("nft", &["delete", "table", "inet", TABLE]);
}

// ---- Windows (Windows Filtering Platform) ----------------------------------

/// Install the switch as WFP filters in our own sublayer (`win::plan::
/// kill_switch_plan`), replacing whatever it held in one transaction. Phase 1
/// (no tunnel yet) passes the endpoint and its control API; phase 2 adds the tunnel devices,
/// named by their LUIDs.
#[cfg(target_os = "windows")]
fn engage_windows(
    endpoint_ip: &str,
    endpoint_port: &str,
    proto: Proto,
    bypass_cidrs: &[String],
    tun_interfaces: &[String],
    dns_servers: &[IpAddr],
) -> Result<(), TunnelError> {
    use crate::win::{net, plan, wfp};

    let endpoint: IpAddr = endpoint_ip
        .parse()
        .map_err(|_| TunnelError::KillSwitch("endpoint is not an IP address"))?;
    let endpoint_port: u16 = endpoint_port
        .parse()
        .map_err(|_| TunnelError::KillSwitch("endpoint port is not a number"))?;
    let bypass = bypass_cidrs
        .iter()
        .map(|c| plan::parse_prefix(c))
        .collect::<Option<Vec<_>>>()
        .ok_or(TunnelError::KillSwitch("invalid bypass prefix"))?;
    let tunnels = tun_interfaces
        .iter()
        .map(|name| net::luid_of(name))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            eprintln!("cumulusvpn-tunnel: kill switch: {e}");
            TunnelError::KillSwitch("tunnel interface not found")
        })?;
    let specs = plan::kill_switch_plan(&plan::KillSwitchInput {
        endpoint,
        endpoint_port,
        endpoint_proto: match proto {
            Proto::Udp => plan::PROTO_UDP,
            Proto::Tcp => plan::PROTO_TCP,
        },
        control_port: GATEWAY_CONTROL_PORT,
        bypass: &bypass,
        resolvers: dns_servers,
        tunnels: &tunnels,
    });
    wfp::replace(wfp::Sublayer::KillSwitch, &specs).map_err(|e| {
        eprintln!("cumulusvpn-tunnel: kill switch: {e}");
        TunnelError::KillSwitch("failed to install the filters")
    })
}

/// Remove our sublayer and its filters. A no-op when the switch is not engaged.
#[cfg(target_os = "windows")]
fn disengage_windows() {
    if let Err(e) = crate::win::wfp::clear(crate::win::wfp::Sublayer::KillSwitch) {
        eprintln!("cumulusvpn-tunnel: kill switch: {e}");
    }
}

// ---- process helpers -------------------------------------------------------

/// Run a command, feeding `stdin_data` on stdin; map failure to `err`.
#[cfg(unix)]
fn run_stdin(
    program: &str,
    args: &[&str],
    stdin_data: &str,
    err: &'static str,
) -> Result<(), TunnelError> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| TunnelError::KillSwitch(err))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(stdin_data.as_bytes())
            .map_err(|_| TunnelError::KillSwitch(err))?;
    }
    match child.wait() {
        Ok(status) if status.success() => Ok(()),
        _ => Err(TunnelError::KillSwitch(err)),
    }
}

/// Best-effort command for teardown paths: never fails the caller.
#[cfg(unix)]
fn run_best_effort(program: &str, args: &[&str]) {
    let _ = super::run_logged(Command::new(program).args(args), program, args);
}

#[cfg(test)]
mod tests {
    use super::{is_safe_cidr, split_endpoint, DEFAULT_WG_PORT};

    #[test]
    fn bypass_prefixes_must_be_pure_address_text() {
        // These are interpolated into firewall rule text — anything but address
        // characters must be rejected before it gets near a rule.
        assert!(is_safe_cidr("10.0.0.0/8"));
        assert!(is_safe_cidr("fe80::/10"));
        assert!(is_safe_cidr("2001:db8::1/128"));
        assert!(!is_safe_cidr(""));
        assert!(!is_safe_cidr("10.0.0.0/8 pass all"));
        assert!(!is_safe_cidr("10.0.0.0/8\nblock"));
        assert!(!is_safe_cidr("$(reboot)"));
    }

    #[test]
    fn parses_ipv4_host_and_port() {
        assert_eq!(split_endpoint("1.2.3.4:51821"), ("1.2.3.4", "51821"));
        assert_eq!(split_endpoint("10.0.0.1:51820"), ("10.0.0.1", "51820"));
    }

    #[test]
    fn missing_port_defaults_to_vanilla() {
        assert_eq!(split_endpoint("1.2.3.4"), ("1.2.3.4", DEFAULT_WG_PORT));
    }

    #[test]
    fn non_numeric_port_is_rejected_and_stripped() {
        // A non-numeric port must never reach a firewall rule; fall back to the
        // default and drop the bad token from the host.
        assert_eq!(split_endpoint("1.2.3.4:evil"), ("1.2.3.4", DEFAULT_WG_PORT));
        assert_eq!(
            split_endpoint("1.2.3.4:80 drop"),
            ("1.2.3.4", DEFAULT_WG_PORT)
        );
        assert_eq!(split_endpoint("1.2.3.4:"), ("1.2.3.4", DEFAULT_WG_PORT));
    }
}

/// The pf ruleset is where the roam-safety property lives, so it gets its
/// own module rather than being folded into the parsing tests above.
#[cfg(test)]
mod macos_ruleset_tests {
    use super::*;

    fn resolver() -> Vec<IpAddr> {
        vec!["1.1.1.1".parse().unwrap()]
    }

    fn rules(tuns: &[String], bypass: &[String]) -> String {
        macos_anchor_rules(
            "203.0.113.7",
            "51820",
            Proto::Udp,
            bypass,
            tuns,
            &resolver(),
        )
    }

    /// The regression this whole change exists for. An interface-scoped block
    /// (`block drop out on en0 all`) fails OPEN the moment the machine roams:
    /// on the new interface nothing matches and pf's default is pass, so
    /// plaintext egresses while the UI still reads "protected".
    #[test]
    fn the_block_is_never_scoped_to_an_interface() {
        let r = rules(&["utun6".into()], &[]);
        assert!(
            r.contains("block drop out all\n"),
            "expected an unqualified catch-all block, got:\n{r}"
        );
        assert!(
            !r.contains("block drop out on "),
            "block must not name an interface, got:\n{r}"
        );
    }

    /// Same reasoning for the endpoint pass: pinned to the connect-time NIC it
    /// would stop matching after a roam, and the tunnel could never recover.
    #[test]
    fn the_endpoint_pass_is_never_scoped_to_an_interface() {
        let r = rules(&["utun6".into()], &[]);
        assert!(r.contains("pass out quick proto udp to 203.0.113.7 port 51820 keep state"));
        assert!(!r.contains("pass out quick on en"), "got:\n{r}");
    }

    /// The gateway's control API (TCP 51821) passes on every transport, on no
    /// particular interface, ahead of the DNS block and the final block.
    #[test]
    fn the_gateway_control_api_passes_on_every_transport() {
        for proto in [Proto::Udp, Proto::Tcp] {
            let r = macos_anchor_rules("203.0.113.7", "51820", proto, &[], &[], &[]);
            let control = r
                .find("pass out quick proto tcp to 203.0.113.7 port 51821 keep state")
                .expect("control API rule");
            assert!(control < r.find("block drop out quick").unwrap(), "{r}");
            assert!(!r.contains("proto udp to 203.0.113.7 port 51821"), "{r}");
        }
    }

    /// Phase 1 runs before any sidecar exists. A total block is correct there —
    /// nothing legitimate is moving yet — but it must still let the handshake
    /// out, or the tunnel it is protecting could never come up.
    #[test]
    fn phase_one_blocks_everything_but_loopback_and_the_endpoint() {
        let r = rules(&[], &[]);
        assert!(r.contains("pass quick on lo0 all"));
        assert!(r.contains("port 51820"));
        assert!(!r.contains("on utun"), "no tun exists yet, got:\n{r}");
        assert!(r.contains("block drop out all"));
    }

    /// Phase 2: once the kernel names are known, tunnel traffic has to be passed
    /// explicitly — the catch-all block would otherwise swallow it.
    #[test]
    fn phase_two_passes_every_tunnel_device() {
        let r = rules(&["utun6".into(), "utun7".into()], &[]);
        assert!(r.contains("pass out quick on utun6 all"));
        assert!(r.contains("pass out quick on utun7 all"));
    }

    /// pf takes the first matching `quick` rule, so every pass must precede the
    /// catch-all block or it is dead text.
    #[test]
    fn passes_precede_the_catch_all_block() {
        let r = rules(&["utun6".into()], &["192.168.0.0/16".into()]);
        let block = r.find("block drop out all").expect("block rule");
        for pass in ["on lo0", "on utun6", "port 51820", "192.168.0.0/16"] {
            let at = r
                .find(pass)
                .unwrap_or_else(|| panic!("missing rule: {pass}"));
            assert!(at < block, "{pass} must come before the block, got:\n{r}");
        }
    }

    /// Split bypass prefixes are fully direct, so they carry no interface either
    /// — the routing table decides where they go (docs/17 §7.1).
    #[test]
    fn bypass_prefixes_are_passed_unscoped() {
        let r = rules(&["utun6".into()], &["10.0.0.0/8".into()]);
        assert!(r.contains("pass out quick to 10.0.0.0/8 keep state"));
    }

    /// The exact anchor text. Pinned in full because the properties above are
    /// about individual lines, and pf cares about the whole file: a stray blank
    /// line or a mis-stripped continuation is a load failure at connect time,
    /// on the user's machine, with the tunnel half-up. The text without the DNS
    /// lines was verified with `pfctl -n -f -` on macOS 15; the DNS lines are
    /// standard pf list syntax but have NOT been through `pfctl -n` yet (no root
    /// on the build machine) — the owner runs `sudo pfctl -vnf -` against this
    /// string as part of the DNS hardware check (docs/16, Stage F). Re-run it
    /// whenever you change this.
    #[test]
    fn the_anchor_text_is_exactly_this() {
        let r = rules(&["utun6".into(), "utun7".into()], &["10.0.0.0/8".into()]);
        assert_eq!(
            r,
            "pass quick on lo0 all\n\
             pass out quick proto udp to 203.0.113.7 port 51820 keep state\n\
             pass out quick proto tcp to 203.0.113.7 port 51821 keep state\n\
             pass out quick on utun6 proto { udp tcp } to { 1.1.1.1 } port { 53 853 } keep state\n\
             pass out quick on utun7 proto { udp tcp } to { 1.1.1.1 } port { 53 853 } keep state\n\
             block drop out quick proto { udp tcp } to any port { 53 853 }\n\
             pass out quick on utun6 all\n\
             pass out quick on utun7 all\n\
             pass out quick to 10.0.0.0/8 keep state\n\
             block drop out all\n"
        );
    }

    /// DNS through the tunnel to the tunnel resolver is the only DNS that may
    /// leave: the pass for it precedes the DNS block, which precedes the general
    /// tunnel pass — so DNS to any OTHER server through the tunnel is dropped.
    #[test]
    fn only_tunnel_dns_to_the_resolver_passes() {
        let r = rules(&["utun6".into()], &[]);
        let dns_pass = r
            .find("pass out quick on utun6 proto { udp tcp } to { 1.1.1.1 } port { 53 853 }")
            .expect("tunnel DNS pass");
        let dns_block = r
            .find("block drop out quick proto { udp tcp } to any port { 53 853 }")
            .expect("DNS block");
        let tun_pass = r.find("pass out quick on utun6 all").expect("tun pass");
        assert!(dns_pass < dns_block && dns_block < tun_pass, "got:\n{r}");
    }

    /// The regression the LAN-bypass case would be: `pass out quick to
    /// 192.168.0.0/16` ahead of the DNS block would reopen DNS to the router.
    #[test]
    fn a_lan_bypass_never_reopens_dns_to_the_router() {
        let r = rules(&["utun6".into()], &["192.168.0.0/16".into()]);
        let dns_block = r.find("port { 53 853 }\n").expect("DNS block");
        let lan = r.find("to 192.168.0.0/16").expect("LAN pass");
        assert!(
            dns_block < lan,
            "DNS block must precede the bypass, got:\n{r}"
        );
    }

    /// The WireGuard endpoint pass precedes the DNS block, so a transport that
    /// ever runs on port 53 is not caught by it.
    #[test]
    fn the_endpoint_pass_precedes_the_dns_block() {
        let r = rules(&["utun6".into()], &[]);
        assert!(r.find("port 51820").unwrap() < r.find("to any port { 53 853 }").unwrap());
    }

    /// No address family on the DNS block: IPv6 resolvers on the physical link
    /// (RDNSS, link-local) are dropped too.
    #[test]
    fn the_dns_block_covers_both_address_families() {
        let r = rules(&["utun6".into()], &[]);
        let line = r
            .lines()
            .find(|l| l.starts_with("block drop out quick"))
            .expect("DNS block");
        assert!(!line.contains("inet"), "{line}");
        assert!(!line.contains(" on "), "{line}");
    }

    /// Phase 1 (no tun yet): no tunnel DNS pass, but the DNS block is there.
    #[test]
    fn phase_one_blocks_all_dns() {
        let r = rules(&[], &[]);
        assert!(!r.contains("to { 1.1.1.1 }"), "got:\n{r}");
        assert!(r.contains("block drop out quick proto { udp tcp } to any port { 53 853 }"));
    }

    /// No resolver in the config: every DNS packet is dropped (fail closed).
    #[test]
    fn without_a_resolver_all_dns_is_blocked() {
        let r = macos_anchor_rules(
            "203.0.113.7",
            "51820",
            Proto::Udp,
            &[],
            &["utun6".into()],
            &[],
        );
        assert!(!r.contains("port { 53 853 } keep state"), "got:\n{r}");
        assert!(r.contains("to any port { 53 853 }"));
    }

    #[test]
    fn several_resolvers_of_both_families_share_one_list() {
        let dns: Vec<IpAddr> = vec![
            "1.1.1.1".parse().unwrap(),
            "2606:4700:4700::1111".parse().unwrap(),
        ];
        let r = macos_anchor_rules(
            "203.0.113.7",
            "51820",
            Proto::Udp,
            &[],
            &["utun6".into()],
            &dns,
        );
        assert!(
            r.contains("to { 1.1.1.1 2606:4700:4700::1111 } port { 53 853 }"),
            "got:\n{r}"
        );
    }

    /// A Settings → DNS provider (two addresses, from the `.conf` line as
    /// `TunnelManager` parses it): both are the allow list on every tunnel
    /// device, nothing else is, and all other DNS is still dropped.
    #[test]
    fn a_provider_pair_is_the_whole_dns_allow_list() {
        let quad9 = crate::dns::parse_servers("9.9.9.9, 149.112.112.112");
        let r = macos_anchor_rules(
            "203.0.113.7",
            "51820",
            Proto::Udp,
            &["192.168.0.0/16".into()],
            &["utun6".into(), "utun7".into()],
            &quad9,
        );
        for tun in ["utun6", "utun7"] {
            assert!(
                r.contains(&format!(
                    "pass out quick on {tun} proto {{ udp tcp }} to {{ 9.9.9.9 149.112.112.112 }} \
                     port {{ 53 853 }} keep state\n"
                )),
                "got:\n{r}"
            );
        }
        assert!(!r.contains("1.1.1.1"), "no default resolver baked in:\n{r}");
        let dns_block = r.find("to any port { 53 853 }").expect("DNS block");
        assert!(r.find("149.112.112.112").unwrap() < dns_block, "{r}");
        assert!(dns_block < r.find("to 192.168.0.0/16").unwrap(), "{r}");
    }

    #[test]
    fn rule_text_inputs_are_validated() {
        assert!(is_safe_iface("utun6"));
        assert!(is_safe_iface("cvpn-entry"));
        assert!(!is_safe_iface(""));
        // Anything that could break out of the rule line and inject its own.
        assert!(!is_safe_iface("utun6\nblock drop"));
        assert!(!is_safe_iface("utun6 all\npass out quick all"));
        assert!(!is_safe_iface("en0;rm"));
    }

    /// A tun name reaches pf as rule text, so a bad one must be refused by
    /// `engage` rather than interpolated.
    #[test]
    fn engage_rejects_an_unsafe_interface_name() {
        let bad = ["utun6\nblock drop out all".to_string()];
        let policy = LeakPolicy {
            endpoint: "203.0.113.7:51820",
            interface: "utun",
            tun_interfaces: &bad,
            proto: Proto::Udp,
            bypass_cidrs: &[],
            bypass_apps: &[],
            dns_servers: &[],
        };
        assert!(engage(Backend::MacosPf, &policy).is_err());
    }
}

/// The nftables table, asserted from any host (it is only loaded on Linux).
#[cfg(test)]
mod linux_ruleset_tests {
    use super::*;

    fn table(bypass: &[String]) -> String {
        linux_nft_table(
            "203.0.113.7",
            "51820",
            Proto::Udp,
            bypass,
            &["1.1.1.1".parse().unwrap()],
        )
    }

    /// The whole table, pinned: nft rejects the file as a unit, at connect
    /// time. Not yet run through `nft -c -f -` (no Linux root here) — part of
    /// the owner's hardware check.
    #[test]
    fn the_table_text_is_exactly_this() {
        assert_eq!(
            table(&["192.168.0.0/16".into()]),
            "table inet cumulusvpn {\n\
             \tchain output {\n\
             \t\ttype filter hook output priority 0; policy drop;\n\
             \t\toifname \"lo\" accept\n\
             \t\tip daddr 203.0.113.7 udp dport 51820 accept\n\
             \t\tip daddr 203.0.113.7 tcp dport 51821 accept\n\
             \t\toifname \"cvpn*\" ip daddr { 1.1.1.1 } udp dport { 53, 853 } accept\n\
             \t\toifname \"cvpn*\" ip daddr { 1.1.1.1 } tcp dport { 53, 853 } accept\n\
             \t\tudp dport { 53, 853 } drop\n\
             \t\ttcp dport { 53, 853 } drop\n\
             \t\toifname \"cvpn*\" accept\n\
             \t\tip daddr 192.168.0.0/16 accept\n\
             \t}\n\
             }\n"
        );
    }

    /// First match wins in an nft chain: the DNS drop must precede both the
    /// tunnel accept (DNS to other servers through the tunnel) and the LAN
    /// bypass accept (DNS to the router).
    #[test]
    fn the_dns_drop_precedes_the_tunnel_and_bypass_accepts() {
        let t = table(&["192.168.0.0/16".into()]);
        let drop = t.find("udp dport { 53, 853 } drop").expect("DNS drop");
        assert!(drop < t.find("oifname \"cvpn*\" accept").unwrap(), "{t}");
        assert!(drop < t.find("192.168.0.0/16").unwrap(), "{t}");
        assert!(t.find("ip daddr 203.0.113.7").unwrap() < drop, "{t}");
    }

    /// The `inet` family covers IPv6: the drop has no family qualifier, so a v6
    /// resolver on the physical link is dropped too; a v6 tunnel resolver gets
    /// its own `ip6` accept.
    #[test]
    fn ipv6_resolvers_are_handled() {
        let t = table(&[]);
        assert!(t.starts_with("table inet "), "{t}");
        assert!(t.contains("\t\ttcp dport { 53, 853 } drop\n"), "{t}");
        let v6 = linux_nft_table(
            "203.0.113.7",
            "51820",
            Proto::Udp,
            &[],
            &["2606:4700:4700::1111".parse().unwrap()],
        );
        assert!(
            v6.contains(
                "oifname \"cvpn*\" ip6 daddr { 2606:4700:4700::1111 } udp dport { 53, 853 } accept"
            ),
            "{v6}"
        );
        assert!(!v6.contains(" ip daddr { "), "{v6}");
    }

    /// A Settings → DNS provider: both addresses in one set, on both
    /// transports, through the tunnel only — and the drop still follows.
    #[test]
    fn a_provider_pair_is_the_whole_dns_allow_list() {
        let quad9 = crate::dns::parse_servers("9.9.9.9, 149.112.112.112");
        let t = linux_nft_table("203.0.113.7", "51820", Proto::Udp, &[], &quad9);
        for l4 in ["udp", "tcp"] {
            assert!(
                t.contains(&format!(
                    "\t\toifname \"cvpn*\" ip daddr {{ 9.9.9.9, 149.112.112.112 }} \
                     {l4} dport {{ 53, 853 }} accept\n"
                )),
                "{t}"
            );
        }
        assert!(!t.contains("1.1.1.1"), "no default resolver baked in: {t}");
        assert!(
            t.find("149.112.112.112").unwrap() < t.find("udp dport { 53, 853 } drop").unwrap(),
            "{t}"
        );
    }

    #[test]
    fn without_a_resolver_all_dns_is_dropped() {
        let t = linux_nft_table("203.0.113.7", "51820", Proto::Tcp, &[], &[]);
        assert!(!t.contains("dport { 53, 853 } accept"), "{t}");
        assert!(t.contains("udp dport { 53, 853 } drop"), "{t}");
        // wg-tls: the endpoint rule follows the transport.
        assert!(
            t.contains("ip daddr 203.0.113.7 tcp dport 51820 accept"),
            "{t}"
        );
    }

    /// The gateway's control API (TCP 51821) is allowed on every transport —
    /// TCP only, so UDP 51821 stays allowed only when it is the endpoint
    /// itself (awg) — and ahead of the DNS drop and the final drop.
    #[test]
    fn the_gateway_control_api_is_allowed_on_every_transport() {
        for proto in [Proto::Udp, Proto::Tcp] {
            let t = linux_nft_table("203.0.113.7", "51820", proto, &[], &[]);
            let control = t
                .find("ip daddr 203.0.113.7 tcp dport 51821 accept")
                .expect("control API rule");
            assert!(
                control < t.find("udp dport { 53, 853 } drop").unwrap(),
                "{t}"
            );
            assert!(!t.contains("udp dport 51821"), "{t}");
        }
        let awg = linux_nft_table("203.0.113.7", "51821", Proto::Udp, &[], &[]);
        assert!(
            awg.contains("ip daddr 203.0.113.7 udp dport 51821 accept"),
            "{awg}"
        );
        assert!(
            awg.contains("ip daddr 203.0.113.7 tcp dport 51821 accept"),
            "{awg}"
        );
    }
}
