//! Kill switch — platform firewall rules that block all non-tunnel traffic so
//! nothing leaks if the WireGuard handshake drops.
//!
//! The policy is identical everywhere: allow loopback, allow the WireGuard
//! endpoint (UDP :51820) and the tunnel interface, drop the rest. Only the
//! mechanism differs per OS. All three are `// POC:` seams with real signatures.

use super::TunnelError;

/// Where the leak-protection rules get installed, per platform.
#[derive(Debug, Clone, Copy)]
pub enum Backend {
    /// macOS packet filter (`pf` via `pfctl` + an anchor).
    MacosPf,
    /// Linux netfilter (`nftables`, falling back to `iptables`).
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

/// Engage the kill switch: permit only loopback, the tunnel interface, and the
/// exact `endpoint` we're about to hand to wireguard-go; drop everything else.
///
/// // POC: real impl shells the platform tool through the privileged helper:
///   - macOS: load a `pf` anchor allowing `udp to <endpoint_ip> port 51820`
///     and `utunN`, blocking `all` otherwise.
///   - Linux: an nftables `inet` table with a default-drop `output` chain plus
///     accepts for the endpoint + `wg` interface + loopback.
///   - Windows: WFP filters keyed to the wintun LUID + endpoint 5-tuple.
pub fn engage(backend: Backend, endpoint: &str, interface: &str) -> Result<(), TunnelError> {
    let _ = (backend, endpoint, interface);
    // POC: install rules. Must be idempotent — re-engaging replaces the set.
    Ok(())
}

/// Remove all kill-switch rules and restore normal routing.
///
/// // POC: unload the pf anchor / delete the nft table / remove WFP filters.
/// Best-effort: on error we log but still tear the tunnel down so the user is
/// never left with a half-applied firewall.
pub fn disengage(backend: Backend) -> Result<(), TunnelError> {
    let _ = backend;
    Ok(())
}
