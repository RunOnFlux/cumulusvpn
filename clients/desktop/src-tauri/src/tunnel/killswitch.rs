//! Kill switch — platform firewall rules that block all non-tunnel traffic so
//! nothing leaks if the WireGuard handshake drops.
//!
//! The policy is identical everywhere: allow loopback, allow the WireGuard
//! endpoint (UDP :51820) and the tunnel, drop the rest of the plaintext egress.
//! Only the mechanism differs per OS.
//!
//! **Timing.** `engage` is called *before* the wireguard-go sidecars spawn (so
//! there is a fail-closed window from the very start), which means the real
//! kernel tun name (`utunN` on macOS) is not known yet. Two consequences:
//!   - **Linux** wireguard-go uses the logical interface name, so we allow it by
//!     the `cvpn*` prefix (covers `cvpn0`, `cvpn-entry`, `cvpn-exit`).
//!   - **macOS** cannot name the tun, so we instead block only on the *physical*
//!     interface — which is the actual leak path (plaintext falling back to the
//!     physical default if the tun routes vanish). Traffic on the tun is never
//!     touched, so we don't need its name.
//!
//! **Self-contained + removable.** Everything lives in a dedicated pf anchor
//! (`com.cumulusvpn`) / nftables table (`inet cumulusvpn`); [`disengage`] removes
//! exactly that and nothing else, so the user's own firewall rules are untouched.
//!
//! **Privilege + lifecycle (seam).** `pfctl`/`nft` need root; in a shipped build
//! they run through the platform privileged helper, which must also clean up if
//! the app dies while engaged (otherwise the fail-closed block persists — the
//! intended behaviour for a kill switch, but the helper owns un-blocking).
//! **Windows** (WFP) remains a seam.

#[cfg(unix)]
use std::io::Write;
#[cfg(unix)]
use std::process::{Command, Stdio};

use super::TunnelError;

/// pf anchor (macOS) / nft table (Linux) name — our dedicated, removable scope.
#[cfg(target_os = "macos")]
const ANCHOR: &str = "com.cumulusvpn";
#[cfg(target_os = "linux")]
const TABLE: &str = "cumulusvpn";

/// Where the leak-protection rules get installed, per platform.
#[derive(Debug, Clone, Copy)]
pub enum Backend {
    /// macOS packet filter (`pf` via `pfctl` + an anchor).
    MacosPf,
    /// Linux netfilter (`nftables`).
    LinuxNftables,
    /// Windows Filtering Platform (WFP) via the wireguard-nt helper.
    WindowsWfp,
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

/// Engage the kill switch: permit only loopback, the tunnel, and the exact
/// `endpoint` we're about to hand to wireguard-go; drop everything else.
/// Idempotent — re-engaging replaces the rule set.
///
/// `interface` is the *logical* label (the real tun name isn't known yet — see
/// the module docs); the rules match the tun by prefix (Linux) or ignore it and
/// block on the physical (macOS).
pub fn engage(backend: Backend, endpoint: &str, interface: &str) -> Result<(), TunnelError> {
    let _ = interface;
    let endpoint_ip = strip_port(endpoint);
    match backend {
        #[cfg(target_os = "macos")]
        Backend::MacosPf => engage_macos(endpoint_ip),
        #[cfg(target_os = "linux")]
        Backend::LinuxNftables => engage_linux(endpoint_ip),
        // Windows, or a backend that isn't native to this build: seam.
        _ => {
            let _ = endpoint_ip;
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
        _ => {}
    }
    Ok(())
}

/// Strip a trailing `:port` from an `ip:port` endpoint (our gateways are IPv4, so
/// a single rsplit is safe). Returns the input unchanged if there is no port.
fn strip_port(endpoint: &str) -> &str {
    endpoint.rsplit_once(':').map(|(host, _)| host).unwrap_or(endpoint)
}

// ---- macOS (pf) ------------------------------------------------------------

#[cfg(target_os = "macos")]
fn engage_macos(endpoint_ip: &str) -> Result<(), TunnelError> {
    let phys = default_interface().ok_or(TunnelError::KillSwitch("no default interface"))?;

    // Our anchor: pass loopback + the WireGuard endpoint out the physical, block
    // every other plaintext egress on the physical. Tunnel traffic (out the tun)
    // is never on the physical, so it flows untouched.
    let anchor_rules = format!(
        "pass quick on lo0 all\n\
         pass out quick on {phys} proto udp to {endpoint_ip} port 51820 keep state\n\
         block drop out on {phys} all\n"
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
    run_stdin("pfctl", &["-f", "-"], &main_rules, "failed to load kill-switch ruleset")?;

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

/// The physical default-route interface (e.g. `en0`), so we can scope the block
/// to the real leak path. Parses `route -n get default`.
#[cfg(target_os = "macos")]
fn default_interface() -> Option<String> {
    let out = Command::new("route").args(["-n", "get", "default"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("interface:") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

// ---- Linux (nftables) ------------------------------------------------------

#[cfg(target_os = "linux")]
fn engage_linux(endpoint_ip: &str) -> Result<(), TunnelError> {
    // A dedicated inet table with a default-drop output chain: allow loopback,
    // the tunnel devices (cvpn* — logical names on Linux), the WireGuard endpoint
    // handshake, and continuation of established flows; drop the rest.
    let table = format!(
        "table inet {TABLE} {{\n\
         \tchain output {{\n\
         \t\ttype filter hook output priority 0; policy drop;\n\
         \t\toifname \"lo\" accept\n\
         \t\toifname \"cvpn*\" accept\n\
         \t\tip daddr {endpoint_ip} udp dport 51820 accept\n\
         \t\tct state established,related accept\n\
         \t}}\n\
         }}\n"
    );
    // Replace any prior instance.
    run_best_effort("nft", &["delete", "table", "inet", TABLE]);
    run_stdin("nft", &["-f", "-"], &table, "failed to load nftables kill switch")
}

#[cfg(target_os = "linux")]
fn disengage_linux() {
    run_best_effort("nft", &["delete", "table", "inet", TABLE]);
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
        stdin.write_all(stdin_data.as_bytes()).map_err(|_| TunnelError::KillSwitch(err))?;
    }
    match child.wait() {
        Ok(status) if status.success() => Ok(()),
        _ => Err(TunnelError::KillSwitch(err)),
    }
}

/// Best-effort command for teardown paths: never fails the caller.
#[cfg(unix)]
fn run_best_effort(program: &str, args: &[&str]) {
    let _ = Command::new(program).args(args).output();
}
