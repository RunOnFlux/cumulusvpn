//! Kill switch — platform firewall rules that block all non-tunnel traffic so
//! nothing leaks if the WireGuard handshake drops.
//!
//! The policy is identical everywhere: allow loopback, allow the WireGuard
//! endpoint (UDP on the transport's port — 51820 vanilla, 51821 for the
//! obfuscated `awg` transport) and the tunnel, drop the rest of the plaintext
//! egress. The port is parsed from the endpoint we're handed, not hardcoded, so
//! Stealth (awg on 51821) isn't dropped by the kill switch.
//! Only the mechanism differs per OS — pf (macOS), nftables (Linux), Windows
//! Firewall / NetSecurity, which sits on top of WFP (Windows).
//!
//! **Timing.** `engage` is called *before* the wireguard-go sidecars spawn (so
//! there is a fail-closed window from the very start), which means the real
//! kernel tun name (`utunN` on macOS) is not known yet. Two consequences:
//!   - **Linux + Windows** wireguard-go uses the logical interface name, so we
//!     allow it by the `cvpn*` prefix (covers `cvpn0`, `cvpn-entry`, `cvpn-exit`).
//!   - **macOS** cannot name the tun up front, so `engage` runs in two phases.
//!     Phase 1 (before the sidecar) blocks *all* egress but loopback and the
//!     endpoint — nothing legitimate is moving yet, so a total block is free.
//!     Phase 2 re-engages with the real `utunN` names once `Sidecar::spawn` has
//!     reported them, adding the pass that lets tunnel traffic out.
//!
//! **Never scope the block to an interface.** An earlier version blocked only on
//! the physical default interface captured at connect time. That fails *open* the
//! moment the machine roams: on the new interface no rule matches, and pf's
//! default is pass, so plaintext egresses freely while the UI still reads
//! "protected". Every backend is now interface-agnostic — a default-drop policy
//! plus explicit passes — which is what Linux (`policy drop`) and Windows
//! (`DefaultOutboundAction Block`) already did, and what makes the switch
//! survive Wi-Fi changes, tethering and dock/undock without re-engaging.
//!
//! **Self-contained + removable.** Everything lives in a dedicated scope — a pf
//! anchor (`com.cumulusvpn`), an nftables table (`inet cumulusvpn`), or a
//! firewall-rule group (`CumulusVPN`) — and [`disengage`] removes exactly that
//! and nothing else, so the user's own firewall rules are untouched. The one
//! exception is the OS-wide default-outbound policy (macOS main ruleset / Windows
//! `DefaultOutboundAction`), which we flip to block while connected and restore
//! on teardown — the standard "own the firewall while up" pattern.
//!
//! **Privilege + lifecycle.** `pfctl`/`nft`/`powershell` need root/Admin. On
//! macOS they run inside the root helper daemon, which outlives the app, so an
//! app crash leaves the switch with something that can still lift it. On Linux
//! and Windows they run in the (elevated) app itself. A clean quit disengages
//! (the app disconnects on exit), but if the app is killed outright the
//! fail-closed block persists until the next connect replaces it or a
//! disconnect clears it. That is the intended direction for a kill switch, and a
//! remaining seam for those two platforms.

#[cfg(unix)]
use std::io::Write;
use std::process::Command;
#[cfg(unix)]
use std::process::Stdio;

use super::TunnelError;

/// pf anchor (macOS) / nft table (Linux) / firewall-rule group (Windows) name —
/// our dedicated, removable scope.
#[cfg(target_os = "macos")]
const ANCHOR: &str = "com.cumulusvpn";
#[cfg(target_os = "linux")]
const TABLE: &str = "cumulusvpn";
#[cfg(target_os = "windows")]
const GROUP: &str = "CumulusVPN";

/// Where the leak-protection rules get installed, per platform.
#[derive(Debug, Clone, Copy)]
pub enum Backend {
    /// macOS packet filter (`pf` via `pfctl` + an anchor).
    MacosPf,
    /// Linux netfilter (`nftables`).
    LinuxNftables,
    /// Windows Firewall via the NetSecurity cmdlets (WFP under the hood).
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
    /// Windows Firewall `-Protocol` spelling.
    #[cfg(target_os = "windows")]
    fn win(self) -> &'static str {
        match self {
            Proto::Udp => "UDP",
            Proto::Tcp => "TCP",
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
    /// phase-1 engage that runs before the sidecar exists. Only macOS needs
    /// these: Linux and Windows match the tun by the `cvpn*` prefix, which is
    /// the real name there, so they ignore this field.
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
        ),
        #[cfg(target_os = "linux")]
        Backend::LinuxNftables => engage_linux(
            endpoint_ip,
            endpoint_port,
            policy.proto,
            policy.bypass_cidrs,
        ),
        #[cfg(target_os = "windows")]
        Backend::WindowsWfp => engage_windows(
            endpoint_ip,
            endpoint_port,
            policy.proto,
            policy.bypass_cidrs,
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
) -> String {
    let proto_s = proto.pf_nft();
    // Our anchor, in pf evaluation order (first matching `quick` rule wins, and
    // the unqualified block is the catch-all):
    //
    //   1. loopback — always;
    //   2. the tunnel devices, once we know their names (phase 2). Before that
    //      the list is empty and nothing is moving through a tun yet;
    //   3. the exact WireGuard endpoint, so the tunnel's own UDP/TCP escapes;
    //   4. every split-tunneling bypass prefix (all protocols — a bypassed
    //      destination is fully direct);
    //   5. drop everything else.
    //
    // Note what is deliberately absent from every rule: an interface. Scoping
    // any of this to the physical NIC would fail open on the first roam (see the
    // module docs). `proto` is udp for vanilla/awg, tcp for wg-tls.
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
         {tun_rules}\
         pass out quick proto {proto_s} to {endpoint_ip} port {endpoint_port} keep state\n\
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
) -> Result<(), TunnelError> {
    let anchor_rules = macos_anchor_rules(
        endpoint_ip,
        endpoint_port,
        proto,
        bypass_cidrs,
        tun_interfaces,
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

#[cfg(target_os = "linux")]
fn engage_linux(
    endpoint_ip: &str,
    endpoint_port: &str,
    proto: Proto,
    bypass_cidrs: &[String],
) -> Result<(), TunnelError> {
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
    // A dedicated inet table with a default-drop output chain: allow loopback,
    // the tunnel devices (cvpn* — logical names on Linux), and the WireGuard
    // endpoint handshake/data (the endpoint rule matches every packet to the
    // gateway, so no conntrack exemption is needed); drop the rest. `proto` is
    // udp for vanilla/awg, tcp for the wg-tls relay connection.
    //
    // Deliberately NO `ct state established,related accept`: that would let every
    // connection open on the physical NIC *before* the tunnel came up keep
    // egressing in plaintext outside the tunnel — a leak, and it's not needed for
    // WireGuard (covered by the endpoint rule). This matches the fail-closed macOS
    // pf ruleset (block all on the physical except loopback + endpoint).
    let table = format!(
        "table inet {TABLE} {{\n\
         \tchain output {{\n\
         \t\ttype filter hook output priority 0; policy drop;\n\
         \t\toifname \"lo\" accept\n\
         \t\toifname \"cvpn*\" accept\n\
         \t\tip daddr {endpoint_ip} {proto_s} dport {endpoint_port} accept\n\
         {bypass_rules}\
         \t}}\n\
         }}\n"
    );
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

// ---- Windows (Windows Firewall / NetSecurity) ------------------------------

#[cfg(target_os = "windows")]
fn engage_windows(
    endpoint_ip: &str,
    endpoint_port: &str,
    proto: Proto,
    bypass_cidrs: &[String],
) -> Result<(), TunnelError> {
    let proto_s = proto.win();
    // Clear any stale rules from a previous run, then add our allow rules BEFORE
    // flipping the default policy to block — so there's never a window where the
    // block is active without the exceptions in place.
    run_best_effort(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            &format!("Remove-NetFirewallRule -Group '{GROUP}' -ErrorAction SilentlyContinue"),
        ],
    );

    // Allow the WireGuard endpoint handshake out (loopback is exempt from Windows
    // Firewall filtering, so it needs no rule).
    run(
        "powershell",
        &["-NoProfile", "-Command", &format!(
            "New-NetFirewallRule -DisplayName 'CumulusVPN kill switch — endpoint' -Group '{GROUP}' \
             -Direction Outbound -Action Allow -Protocol {proto_s} -RemoteAddress {endpoint_ip} -RemotePort {endpoint_port} | Out-Null"
        )],
        "failed to add endpoint allow rule",
    )?;

    // Allow all traffic out the tunnel adapter(s): cvpn0 (single) / cvpn-entry +
    // cvpn-exit (multi-hop). -InterfaceAlias accepts a wildcard.
    run(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            &format!(
            "New-NetFirewallRule -DisplayName 'CumulusVPN kill switch — tunnel' -Group '{GROUP}' \
             -Direction Outbound -Action Allow -InterfaceAlias 'cvpn*' | Out-Null"
        ),
        ],
        "failed to add tunnel allow rule",
    )?;

    // Split-tunneling bypass prefixes (one rule for the whole set — Windows
    // Firewall accepts a CIDR list in -RemoteAddress).
    if !bypass_cidrs.is_empty() {
        let list = bypass_cidrs.join(",");
        run(
            "powershell",
            &["-NoProfile", "-Command", &format!(
                "New-NetFirewallRule -DisplayName 'CumulusVPN kill switch — split bypass' -Group '{GROUP}' \
                 -Direction Outbound -Action Allow -RemoteAddress {list} | Out-Null"
            )],
            "failed to add split bypass rule",
        )?;
    }

    // Block everything else outbound by default; the allow rules above take
    // precedence over the default block.
    run(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            "Set-NetFirewallProfile -All -DefaultOutboundAction Block",
        ],
        "failed to set block policy",
    )?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn disengage_windows() {
    // Restore the default (allow) policy first so traffic flows again, then drop
    // our rules.
    run_best_effort(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            "Set-NetFirewallProfile -All -DefaultOutboundAction Allow",
        ],
    );
    run_best_effort(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            &format!("Remove-NetFirewallRule -Group '{GROUP}' -ErrorAction SilentlyContinue"),
        ],
    );
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

/// Run a command (args only), mapping a non-zero exit or spawn failure to `err`.
#[cfg(target_os = "windows")]
fn run(program: &str, args: &[&str], err: &'static str) -> Result<(), TunnelError> {
    match Command::new(program).args(args).output() {
        Ok(out) if out.status.success() => Ok(()),
        _ => Err(TunnelError::KillSwitch(err)),
    }
}

/// Best-effort command for teardown paths: never fails the caller.
fn run_best_effort(program: &str, args: &[&str]) {
    let _ = Command::new(program).args(args).output();
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

    fn rules(tuns: &[String], bypass: &[String]) -> String {
        macos_anchor_rules("203.0.113.7", "51820", Proto::Udp, bypass, tuns)
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

    /// The exact anchor text, verified to parse with `pfctl -n -f -` on macOS
    /// 15. Pinned in full because the properties above are about individual
    /// lines, and pf cares about the whole file: a stray blank line or a
    /// mis-stripped continuation is a load failure at connect time, on the
    /// user's machine, with the tunnel half-up. Re-run `pfctl -n -f` against the
    /// new text if you change this.
    #[test]
    fn the_anchor_text_is_exactly_this() {
        let r = rules(&["utun6".into(), "utun7".into()], &["10.0.0.0/8".into()]);
        assert_eq!(
            r,
            "pass quick on lo0 all\n\
             pass out quick on utun6 all\n\
             pass out quick on utun7 all\n\
             pass out quick proto udp to 203.0.113.7 port 51820 keep state\n\
             pass out quick to 10.0.0.0/8 keep state\n\
             block drop out all\n"
        );
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
        };
        assert!(engage(Backend::MacosPf, &policy).is_err());
    }
}
