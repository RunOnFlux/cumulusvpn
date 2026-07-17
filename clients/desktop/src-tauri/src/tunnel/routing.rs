//! Interface + route programming for the tunnel data plane.
//!
//! wireguard-go handles crypto only; assigning the tunnel address, setting the
//! MTU, and editing the routing table are the host's job — exactly what
//! `wg-quick` does around the userspace daemon. This module is the real
//! implementation of that, driven with the platform CLIs (`ifconfig`/`route` on
//! macOS, `ip` on Linux).
//!
//! **Single-hop** (`TunnelManager::connect`): bring the interface up, pin the
//! WireGuard endpoint to the physical default gateway (so the encrypted UDP
//! escapes instead of recursing into the tunnel), then install the split-default
//! `0.0.0.0/1 + 128.0.0.0/1` pair pointing at the tunnel.
//!
//! **Multi-hop** (`docs/11-multihop.md`, `TunnelManager::connect_multihop`): two
//! wireguard-go devices. Additionally a host route `<exitIp>/32 → wg-entry`, so
//! the *only* thing the outer (entry) tunnel carries is the inner tunnel's UDP
//! packets to the exit's public IP (the outer `.conf` pins
//! `AllowedIPs = <exitIp>/32`); the default route then points at the inner
//! (exit) device.
//!
//! **Privilege:** every route/ifconfig edit needs root/Admin. Run unelevated
//! they fail and the connect attempt reports an error; in a shipped build these
//! commands run through the platform privileged helper (macOS `SMAppService`,
//! Linux `polkit`, Windows service). The command construction is real; only the
//! elevation transport is the seam. **Windows** route programming (WFP / the
//! wireguard-nt helper keyed to the interface LUID) is a marked seam below.

use std::process::Command;

use super::TunnelError;

/// Run a command, mapping a non-zero exit (or spawn failure) to `err`.
#[cfg(unix)]
fn run(program: &str, args: &[&str], err: &'static str) -> Result<(), TunnelError> {
    match Command::new(program).args(args).output() {
        Ok(out) if out.status.success() => Ok(()),
        Ok(_) => Err(TunnelError::Sidecar(err)),
        Err(_) => Err(TunnelError::Sidecar(err)),
    }
}

/// Best-effort variant for teardown paths: never fails the caller.
#[cfg(unix)]
fn run_best_effort(program: &str, args: &[&str]) {
    let _ = Command::new(program).args(args).output();
}

/// Discover the current physical default gateway, so the WireGuard endpoint can
/// be pinned to it (the classic `wg-quick` endpoint bypass).
#[cfg(target_os = "macos")]
fn default_gateway() -> Option<String> {
    let out = Command::new("route").args(["-n", "get", "default"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("gateway:") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn default_gateway() -> Option<String> {
    let out = Command::new("ip").args(["route", "show", "default"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    // e.g. "default via 192.168.1.1 dev en0 ..."
    let mut it = text.split_whitespace();
    while let Some(tok) = it.next() {
        if tok == "via" {
            return it.next().map(|s| s.to_string());
        }
    }
    None
}

/// Bring the TUN device up with its tunnel address and MTU.
///
/// // Runs through the privileged helper in a shipped build; the command line is
/// real. Windows brings the wintun adapter up via the wireguard-nt helper.
pub fn configure_interface(interface: &str, address: &str, mtu: u16) -> Result<(), TunnelError> {
    #[cfg(target_os = "macos")]
    {
        // utun is point-to-point: use the address on both ends.
        run(
            "ifconfig",
            &[interface, "inet", address, address, "up"],
            "failed to assign interface address (needs root)",
        )?;
        run(
            "ifconfig",
            &[interface, "mtu", &mtu.to_string()],
            "failed to set interface MTU",
        )?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let cidr = format!("{address}/32");
        run(
            "ip",
            &["address", "add", &cidr, "dev", interface],
            "failed to assign interface address (needs root)",
        )?;
        run(
            "ip",
            &["link", "set", "mtu", &mtu.to_string(), "up", "dev", interface],
            "failed to set interface MTU / bring link up",
        )?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        // POC (Windows): set the wintun adapter address + MTU via the
        // wireguard-nt helper keyed to the interface LUID.
        let _ = (interface, address, mtu);
        Err(TunnelError::Sidecar(
            "interface configuration not implemented on this platform",
        ))
    }
}

/// Pin the WireGuard endpoint IP to the physical default gateway, so the
/// tunnel's own encrypted UDP is not swallowed by the default route we are about
/// to point at the tunnel. Mirrors `wg-quick`'s endpoint host route.
pub fn add_endpoint_bypass(endpoint_ip: &str) -> Result<(), TunnelError> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let gw = default_gateway()
            .ok_or(TunnelError::Sidecar("could not determine default gateway for endpoint bypass"))?;
        #[cfg(target_os = "macos")]
        {
            run(
                "route",
                &["-n", "add", "-host", endpoint_ip, &gw],
                "failed to add endpoint bypass route (needs root)",
            )
        }
        #[cfg(target_os = "linux")]
        {
            let cidr = format!("{endpoint_ip}/32");
            run(
                "ip",
                &["route", "add", &cidr, "via", &gw],
                "failed to add endpoint bypass route (needs root)",
            )
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = endpoint_ip;
        Err(TunnelError::Sidecar(
            "endpoint bypass not implemented on this platform",
        ))
    }
}

/// Remove the endpoint bypass host route. Best-effort teardown.
pub fn remove_endpoint_bypass(endpoint_ip: &str) {
    #[cfg(target_os = "macos")]
    run_best_effort("route", &["-n", "delete", "-host", endpoint_ip]);
    #[cfg(target_os = "linux")]
    run_best_effort("ip", &["route", "del", &format!("{endpoint_ip}/32")]);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = endpoint_ip;
}

/// Pin a single host (`<dest_ip>/32`) to a specific interface. Used to force the
/// exit's UDP endpoint through the entry (outer) tunnel in multi-hop.
pub fn add_host_route(dest_ip: &str, via_interface: &str) -> Result<(), TunnelError> {
    #[cfg(target_os = "macos")]
    {
        run(
            "route",
            &["-n", "add", "-host", dest_ip, "-interface", via_interface],
            "failed to add host route (needs root)",
        )
    }
    #[cfg(target_os = "linux")]
    {
        let cidr = format!("{dest_ip}/32");
        run(
            "ip",
            &["route", "add", &cidr, "dev", via_interface],
            "failed to add host route (needs root)",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        // POC (Windows): route add <dest_ip> mask 255.255.255.255 keyed to the
        // interface LUID via the wireguard-nt helper.
        let _ = (dest_ip, via_interface);
        Err(TunnelError::Sidecar(
            "host route not implemented on this platform",
        ))
    }
}

/// Point the default route at the given (tunnel) interface so all real traffic
/// egresses there. Uses the split-default `0.0.0.0/1 + 128.0.0.0/1` pair (+ v6)
/// like `wg-quick`, so a more-specific host route (e.g. the multi-hop exit
/// endpoint via wg-entry) still wins.
pub fn add_default_route(via_interface: &str) -> Result<(), TunnelError> {
    #[cfg(target_os = "macos")]
    {
        run(
            "route",
            &["-n", "add", "-net", "0.0.0.0/1", "-interface", via_interface],
            "failed to add default route half 0.0.0.0/1 (needs root)",
        )?;
        run(
            "route",
            &["-n", "add", "-net", "128.0.0.0/1", "-interface", via_interface],
            "failed to add default route half 128.0.0.0/1 (needs root)",
        )?;
        // IPv6 split-default (best-effort: hosts without v6 will reject it).
        run_best_effort("route", &["-n", "add", "-inet6", "-net", "::/1", "-interface", via_interface]);
        run_best_effort("route", &["-n", "add", "-inet6", "-net", "8000::/1", "-interface", via_interface]);
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        run(
            "ip",
            &["route", "add", "0.0.0.0/1", "dev", via_interface],
            "failed to add default route half 0.0.0.0/1 (needs root)",
        )?;
        run(
            "ip",
            &["route", "add", "128.0.0.0/1", "dev", via_interface],
            "failed to add default route half 128.0.0.0/1 (needs root)",
        )?;
        run_best_effort("ip", &["-6", "route", "add", "::/1", "dev", via_interface]);
        run_best_effort("ip", &["-6", "route", "add", "8000::/1", "dev", via_interface]);
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        // POC (Windows): default-route metric override on the tunnel LUID.
        let _ = via_interface;
        Err(TunnelError::Sidecar(
            "default route not implemented on this platform",
        ))
    }
}

/// Install the tunnel DNS resolver.
///
/// // POC / marked seam: DNS is system-wide and its mechanism is intrusive —
/// macOS drives `networksetup -setdnsservers` (or `scutil`) across every
/// network service with save/restore, Linux uses `resolvconf` /
/// `systemd-resolved`, Windows sets it per-adapter. All of this runs through the
/// privileged helper in a shipped build, so it stays a seam here. Without it the
/// tunnel still carries traffic; only name resolution keeps using the old
/// resolver (a DNS-leak the kill switch's UI must flag until this is wired).
pub fn set_dns(interface: &str, dns: &str) -> Result<(), TunnelError> {
    let _ = (interface, dns);
    Ok(())
}

/// Remove the multi-hop exit host route installed by [`add_host_route`]. The
/// split-default routes disappear with the interface when its sidecar is killed,
/// so only the exit pin needs explicit removal. Best-effort on teardown.
pub fn clear_multihop_routes(exit_ip: &str) -> Result<(), TunnelError> {
    #[cfg(target_os = "macos")]
    run_best_effort("route", &["-n", "delete", "-host", exit_ip]);
    #[cfg(target_os = "linux")]
    run_best_effort("ip", &["route", "del", &format!("{exit_ip}/32")]);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = exit_ip;
    Ok(())
}
