//! Interface + route programming for the tunnel data plane.
//!
//! wireguard-go handles crypto only; assigning the tunnel address, setting the
//! MTU, and editing the routing table are the host's job — exactly what
//! `wg-quick` does around the userspace daemon. This module is the real
//! implementation of that, driven with the platform CLIs (`ifconfig`/`route` on
//! macOS, `ip` on Linux, `netsh` on Windows).
//!
//! **Windows tooling choice:** `netsh interface ipv4/ipv6` rather than
//! `route.exe` — route.exe wants dotted-decimal masks plus numeric IF indexes
//! and cannot express an interface-scoped on-link route (it demands a next
//! hop), while netsh takes CIDR prefixes and adapter names for both the
//! gateway and the on-link (`nexthop` omitted → `0.0.0.0` → on-link) forms.
//! Gateway/interface *discovery* and route *removal* go through PowerShell's
//! NetRoute cmdlets: `route print` output is localized (unparseable), and
//! `netsh ... delete route` requires naming the interface, which teardown must
//! not depend on rediscovering.
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
//! they fail and the connect attempt reports an error (Windows checks up front
//! — see `super::ensure_elevated`); in a shipped build these commands run
//! through the platform privileged helper (macOS `SMAppService`, Linux
//! `polkit`, Windows service). The command construction is real; only the
//! elevation transport is the seam.

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

/// Run a command, mapping a non-zero exit (or spawn failure) to `err`.
/// `CREATE_NO_WINDOW`: see [`super::CREATE_NO_WINDOW`].
#[cfg(windows)]
fn run(program: &str, args: &[&str], err: &'static str) -> Result<(), TunnelError> {
    use std::os::windows::process::CommandExt;
    match Command::new(program)
        .args(args)
        .creation_flags(super::CREATE_NO_WINDOW)
        .output()
    {
        Ok(out) if out.status.success() => Ok(()),
        Ok(_) => Err(TunnelError::Sidecar(err)),
        Err(_) => Err(TunnelError::Sidecar(err)),
    }
}

/// Best-effort variant for teardown paths: never fails the caller.
#[cfg(windows)]
fn run_best_effort(program: &str, args: &[&str]) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new(program)
        .args(args)
        .creation_flags(super::CREATE_NO_WINDOW)
        .output();
}

/// Evaluate a PowerShell expression and return its trimmed first output line.
/// The route discovery below reads CIM object properties instead of parsing
/// `route print`, whose table output is localized per Windows language.
#[cfg(windows)]
fn powershell_value(script: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .creation_flags(super::CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let value = text.trim().lines().next()?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Remove a route by destination prefix, best-effort. `Remove-NetRoute` takes a
/// bare CIDR and no interface (see the module docs on why not netsh here). The
/// prefix is interpolated into PowerShell text, so refuse anything but address
/// characters — same defense-in-depth as `killswitch::is_safe_cidr`.
#[cfg(windows)]
fn remove_route_best_effort(prefix: &str) {
    let safe = !prefix.is_empty()
        && prefix
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'.' || b == b':' || b == b'/');
    if !safe {
        return;
    }
    run_best_effort(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            &format!("Remove-NetRoute -DestinationPrefix '{prefix}' -Confirm:$false -ErrorAction SilentlyContinue"),
        ],
    );
}

/// Discover the current physical default gateway, so the WireGuard endpoint can
/// be pinned to it (the classic `wg-quick` endpoint bypass).
#[cfg(target_os = "macos")]
fn default_gateway() -> Option<String> {
    let out = Command::new("route")
        .args(["-n", "get", "default"])
        .output()
        .ok()?;
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
    let out = Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .ok()?;
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

/// Windows: the lowest-cost IPv4 default route's next hop. Route + interface
/// metrics are summed because that is how the stack itself picks between
/// multiple default routes (e.g. Wi-Fi and Ethernet both up). The tunnel's own
/// split-default `/1` pair never matches `0.0.0.0/0`, so this stays correct
/// while connected.
#[cfg(windows)]
fn default_gateway() -> Option<String> {
    powershell_value(
        "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Sort-Object -Property @{Expression={$_.RouteMetric + $_.InterfaceMetric}} | Select-Object -First 1).NextHop",
    )
}

/// Bring the TUN device up with its tunnel address and MTU.
///
/// // Runs through the privileged helper in a shipped build; the command line is
/// real. Windows addresses the wintun adapter by its alias via netsh.
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
            &[
                "link",
                "set",
                "mtu",
                &mtu.to_string(),
                "up",
                "dev",
                interface,
            ],
            "failed to set interface MTU / bring link up",
        )?;
        Ok(())
    }
    #[cfg(windows)]
    {
        // wintun is L3 point-to-point like utun: a /32 host address is all the
        // adapter needs (the on-link routes below do the steering). The adapter
        // link is already up — wintun adapters come up when wireguard-go
        // creates them — so unlike Unix there is no separate "up" step.
        run(
            "netsh",
            &[
                "interface",
                "ipv4",
                "set",
                "address",
                &format!("name={interface}"),
                "static",
                address,
                "255.255.255.255",
            ],
            "failed to assign interface address (needs Administrator)",
        )?;
        run(
            "netsh",
            &[
                "interface",
                "ipv4",
                "set",
                "subinterface",
                interface,
                &format!("mtu={mtu}"),
                "store=active",
            ],
            "failed to set interface MTU",
        )?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
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
        let gw = default_gateway().ok_or(TunnelError::Sidecar(
            "could not determine default gateway for endpoint bypass",
        ))?;
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
    #[cfg(windows)]
    {
        // netsh needs the interface as well as the next hop; both come from the
        // same lowest-metric default route, so they are consistent by
        // construction.
        let gw = default_gateway().ok_or(TunnelError::Sidecar(
            "could not determine default gateway for endpoint bypass",
        ))?;
        let phys = default_interface().ok_or(TunnelError::Sidecar(
            "could not determine default interface for endpoint bypass",
        ))?;
        run(
            "netsh",
            &[
                "interface",
                "ipv4",
                "add",
                "route",
                &format!("{endpoint_ip}/32"),
                &phys,
                &gw,
            ],
            "failed to add endpoint bypass route (needs Administrator)",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
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
    #[cfg(windows)]
    remove_route_best_effort(&format!("{endpoint_ip}/32"));
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
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
    #[cfg(windows)]
    {
        // No nexthop → on-link via the (tunnel) adapter, the netsh equivalent
        // of `route -interface` / `ip route ... dev` (see the module docs).
        run(
            "netsh",
            &[
                "interface",
                "ipv4",
                "add",
                "route",
                &format!("{dest_ip}/32"),
                via_interface,
            ],
            "failed to add host route (needs Administrator)",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
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
            &[
                "-n",
                "add",
                "-net",
                "0.0.0.0/1",
                "-interface",
                via_interface,
            ],
            "failed to add default route half 0.0.0.0/1 (needs root)",
        )?;
        run(
            "route",
            &[
                "-n",
                "add",
                "-net",
                "128.0.0.0/1",
                "-interface",
                via_interface,
            ],
            "failed to add default route half 128.0.0.0/1 (needs root)",
        )?;
        // IPv6 split-default (best-effort: hosts without v6 will reject it).
        run_best_effort(
            "route",
            &[
                "-n",
                "add",
                "-inet6",
                "-net",
                "::/1",
                "-interface",
                via_interface,
            ],
        );
        run_best_effort(
            "route",
            &[
                "-n",
                "add",
                "-inet6",
                "-net",
                "8000::/1",
                "-interface",
                via_interface,
            ],
        );
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
        run_best_effort(
            "ip",
            &["-6", "route", "add", "8000::/1", "dev", via_interface],
        );
        Ok(())
    }
    #[cfg(windows)]
    {
        run(
            "netsh",
            &[
                "interface",
                "ipv4",
                "add",
                "route",
                "0.0.0.0/1",
                via_interface,
            ],
            "failed to add default route half 0.0.0.0/1 (needs Administrator)",
        )?;
        run(
            "netsh",
            &[
                "interface",
                "ipv4",
                "add",
                "route",
                "128.0.0.0/1",
                via_interface,
            ],
            "failed to add default route half 128.0.0.0/1 (needs Administrator)",
        )?;
        // IPv6 split-default (best-effort: hosts without v6 will reject it).
        run_best_effort(
            "netsh",
            &["interface", "ipv6", "add", "route", "::/1", via_interface],
        );
        run_best_effort(
            "netsh",
            &[
                "interface",
                "ipv6",
                "add",
                "route",
                "8000::/1",
                via_interface,
            ],
        );
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        let _ = via_interface;
        Err(TunnelError::Sidecar(
            "default route not implemented on this platform",
        ))
    }
}

/// True for prefixes that are on-link by nature (link-local, multicast,
/// broadcast) — routing those "via the default gateway" is wrong; they must be
/// scoped to the physical interface instead.
#[cfg(any(target_os = "macos", target_os = "linux", windows))]
fn is_link_scoped(cidr: &str) -> bool {
    let lower = cidr.to_ascii_lowercase();
    lower.starts_with("169.254.")
        || lower.starts_with("224.")
        || lower.starts_with("255.255.255.255")
        || lower.starts_with("fe80:")
        || lower.starts_with("ff")
}

/// The physical default-route interface name, for scoping link-local bypass
/// routes. macOS parses `route -n get default`; Linux `ip route show default`.
#[cfg(target_os = "macos")]
fn default_interface() -> Option<String> {
    let out = Command::new("route")
        .args(["-n", "get", "default"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("interface:") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn default_interface() -> Option<String> {
    let out = Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut it = text.split_whitespace();
    while let Some(tok) = it.next() {
        if tok == "dev" {
            return it.next().map(|s| s.to_string());
        }
    }
    None
}

/// Windows: the lowest-cost default route's adapter alias — same selection as
/// [`default_gateway`], so the netsh gateway routes name a consistent pair.
#[cfg(windows)]
fn default_interface() -> Option<String> {
    powershell_value(
        "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Sort-Object -Property @{Expression={$_.RouteMetric + $_.InterfaceMetric}} | Select-Object -First 1).InterfaceAlias",
    )
}

/// Install split-tunneling **bypass** routes (docs/17): each prefix is routed
/// via the physical path — the default gateway for real destinations, the
/// physical interface itself for link-scoped space — so it wins over the
/// tunnel's split-default `/1` pair by being more specific.
///
/// v4 prefixes must install (a silently missing bypass means traffic the user
/// excluded still tunnels — surprising but safe; a hard error keeps it
/// honest). v6 is best-effort, mirroring [`add_default_route`]'s v6 handling
/// on hosts without v6 connectivity.
pub fn add_bypass_routes(cidrs: &[String]) -> Result<(), TunnelError> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        if cidrs.is_empty() {
            return Ok(());
        }
        let gw = default_gateway();
        let phys = default_interface();
        for cidr in cidrs {
            let v6 = cidr.contains(':');
            let link = is_link_scoped(cidr);
            #[cfg(target_os = "macos")]
            {
                let mut args: Vec<&str> = vec!["-n", "add"];
                if v6 {
                    args.push("-inet6");
                }
                args.extend(["-net", cidr]);
                if link {
                    let Some(phys) = phys.as_deref() else {
                        continue;
                    };
                    args.extend(["-interface", phys]);
                } else if v6 {
                    // No v6 gateway discovery: scope to the physical interface.
                    let Some(phys) = phys.as_deref() else {
                        continue;
                    };
                    args.extend(["-interface", phys]);
                } else {
                    let Some(gw) = gw.as_deref() else {
                        return Err(TunnelError::Sidecar(
                            "could not determine default gateway for bypass route",
                        ));
                    };
                    args.push(gw);
                }
                if v6 || link {
                    run_best_effort("route", &args);
                } else {
                    run("route", &args, "failed to add bypass route (needs root)")?;
                }
            }
            #[cfg(target_os = "linux")]
            {
                let mut args: Vec<&str> = if v6 {
                    vec!["-6", "route", "add", cidr]
                } else {
                    vec!["route", "add", cidr]
                };
                if link {
                    let Some(phys) = phys.as_deref() else {
                        continue;
                    };
                    args.extend(["dev", phys]);
                } else if v6 {
                    let Some(phys) = phys.as_deref() else {
                        continue;
                    };
                    args.extend(["dev", phys]);
                } else {
                    let Some(gw) = gw.as_deref() else {
                        return Err(TunnelError::Sidecar(
                            "could not determine default gateway for bypass route",
                        ));
                    };
                    args.extend(["via", gw]);
                }
                if v6 || link {
                    run_best_effort("ip", &args);
                } else {
                    run("ip", &args, "failed to add bypass route (needs root)")?;
                }
            }
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        if cidrs.is_empty() {
            return Ok(());
        }
        let gw = default_gateway();
        let phys = default_interface();
        for cidr in cidrs {
            let v6 = cidr.contains(':');
            let link = is_link_scoped(cidr);
            if link || v6 {
                // Link-scoped space must not point at a gateway, and there is
                // no v6 gateway discovery: scope both on-link to the physical
                // adapter, best-effort — mirroring the Unix branches.
                let Some(phys) = phys.as_deref() else {
                    continue;
                };
                let family = if v6 { "ipv6" } else { "ipv4" };
                run_best_effort("netsh", &["interface", family, "add", "route", cidr, phys]);
            } else {
                let (Some(gw), Some(phys)) = (gw.as_deref(), phys.as_deref()) else {
                    return Err(TunnelError::Sidecar(
                        "could not determine default gateway for bypass route",
                    ));
                };
                run(
                    "netsh",
                    &["interface", "ipv4", "add", "route", cidr, phys, gw],
                    "failed to add bypass route (needs Administrator)",
                )?;
            }
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        // Split-by-IP is gated on the route seam being real (docs/17 §4.4) —
        // refuse rather than silently not bypassing.
        if cidrs.is_empty() {
            return Ok(());
        }
        Err(TunnelError::Sidecar(
            "split-tunneling routes not implemented on this platform",
        ))
    }
}

/// Remove the bypass routes installed by [`add_bypass_routes`]. Best-effort
/// teardown (a vanished interface already dropped its scoped routes).
pub fn remove_bypass_routes(cidrs: &[String]) {
    for cidr in cidrs {
        let _v6 = cidr.contains(':');
        #[cfg(target_os = "macos")]
        {
            if _v6 {
                run_best_effort("route", &["-n", "delete", "-inet6", "-net", cidr]);
            } else {
                run_best_effort("route", &["-n", "delete", "-net", cidr]);
            }
        }
        #[cfg(target_os = "linux")]
        {
            if _v6 {
                run_best_effort("ip", &["-6", "route", "del", cidr]);
            } else {
                run_best_effort("ip", &["route", "del", cidr]);
            }
        }
        #[cfg(windows)]
        remove_route_best_effort(cidr);
        #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
        let _ = cidr;
    }
}

/// Install split-tunneling **include-mode** routes: only these prefixes enter
/// the tunnel; the system default route stays on the physical path. Used
/// INSTEAD of [`add_default_route`] when the compiled policy carries
/// `tunnelRoutes`. Routes are interface-scoped, so they disappear with the
/// device on teardown — no explicit removal needed.
pub fn add_tunnel_routes(cidrs: &[String], via_interface: &str) -> Result<(), TunnelError> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        for cidr in cidrs {
            let v6 = cidr.contains(':');
            #[cfg(target_os = "macos")]
            {
                if v6 {
                    run_best_effort(
                        "route",
                        &[
                            "-n",
                            "add",
                            "-inet6",
                            "-net",
                            cidr,
                            "-interface",
                            via_interface,
                        ],
                    );
                } else {
                    run(
                        "route",
                        &["-n", "add", "-net", cidr, "-interface", via_interface],
                        "failed to add tunnel route (needs root)",
                    )?;
                }
            }
            #[cfg(target_os = "linux")]
            {
                if v6 {
                    run_best_effort("ip", &["-6", "route", "add", cidr, "dev", via_interface]);
                } else {
                    run(
                        "ip",
                        &["route", "add", cidr, "dev", via_interface],
                        "failed to add tunnel route (needs root)",
                    )?;
                }
            }
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        for cidr in cidrs {
            if cidr.contains(':') {
                run_best_effort(
                    "netsh",
                    &["interface", "ipv6", "add", "route", cidr, via_interface],
                );
            } else {
                run(
                    "netsh",
                    &["interface", "ipv4", "add", "route", cidr, via_interface],
                    "failed to add tunnel route (needs Administrator)",
                )?;
            }
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        let _ = via_interface;
        if cidrs.is_empty() {
            return Ok(());
        }
        Err(TunnelError::Sidecar(
            "split-tunneling routes not implemented on this platform",
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
    #[cfg(windows)]
    remove_route_best_effort(&format!("{exit_ip}/32"));
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    let _ = exit_ip;
    Ok(())
}
