//! What the Windows backend installs, as plain data: the WFP filters of the
//! kill switch and of the DNS leak block, the choice of default route, and the
//! parsing of the prefixes and stored firewall rules they start from. Nothing
//! here calls Windows, so the decisions are tested on every host; `super::wfp`
//! and `super::net` turn them into API calls.
//!
//! **How WFP evaluates these.** Every filter lives in one of our sublayers at
//! `ALE_AUTH_CONNECT_V4` / `_V6` — where an outbound connection (or the first
//! datagram of a UDP flow) is authorized. Within a sublayer the matching
//! filter of highest weight decides; across sublayers a block anywhere beats a
//! permit. So each sublayer is an ordered list: specific permits above the
//! blocks they carve holes in. Conditions on the *same* field are ORed, on
//! different fields ANDed — `[RemotePort(53), RemotePort(853), Protocol(UDP)]`
//! is "UDP to port 53 or 853".

use std::net::IpAddr;

/// IANA protocol numbers WFP matches on (`FWPM_CONDITION_IP_PROTOCOL`).
pub(crate) const PROTO_TCP: u8 = 6;
pub(crate) const PROTO_UDP: u8 = 17;
pub(crate) const PROTO_ICMPV6: u8 = 58;

/// DNS and DNS over TLS / QUIC.
const DNS_PORTS: [u16; 2] = [53, 853];

/// Neighbor Discovery (router solicitation/advertisement, neighbor
/// solicitation/advertisement, redirect). At the ALE layers WFP reports an
/// ICMP type as the local port.
const NDP_TYPES: [u16; 5] = [133, 134, 135, 136, 137];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Family {
    V4,
    V6,
}

impl Family {
    pub(crate) fn of(ip: &IpAddr) -> Family {
        match ip {
            IpAddr::V4(_) => Family::V4,
            IpAddr::V6(_) => Family::V6,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Action {
    Permit,
    Block,
}

/// One filter condition. See the module docs for how several combine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Cond {
    RemoteAddr(IpAddr),
    RemotePrefix(IpAddr, u8),
    RemotePort(u16),
    /// The local port; for ICMP, the ICMP type.
    LocalPort(u16),
    Protocol(u8),
    /// The interface the connection leaves by, as its LUID.
    LocalInterface(u64),
    Loopback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FilterSpec {
    pub(crate) name: &'static str,
    pub(crate) family: Family,
    /// 0–15; the highest matching weight in a sublayer decides.
    pub(crate) weight: u8,
    pub(crate) action: Action,
    pub(crate) conds: Vec<Cond>,
}

fn filter(
    name: &'static str,
    family: Family,
    weight: u8,
    action: Action,
    conds: Vec<Cond>,
) -> FilterSpec {
    FilterSpec {
        name,
        family,
        weight,
        action,
        conds,
    }
}

fn dns_match() -> Vec<Cond> {
    let mut c: Vec<Cond> = DNS_PORTS.iter().map(|p| Cond::RemotePort(*p)).collect();
    c.push(Cond::Protocol(PROTO_UDP));
    c.push(Cond::Protocol(PROTO_TCP));
    c
}

const BOTH: [Family; 2] = [Family::V4, Family::V6];

/// What the kill switch lets out.
#[derive(Debug, Clone)]
pub(crate) struct KillSwitchInput<'a> {
    /// The address the sidecar (or the wg-tls bridge) dials.
    pub(crate) endpoint: IpAddr,
    pub(crate) endpoint_port: u16,
    pub(crate) endpoint_proto: u8,
    /// The gateway's control API port on the endpoint's address (TCP).
    pub(crate) control_port: u16,
    /// Split-tunnel exclusions, allowed out directly.
    pub(crate) bypass: &'a [(IpAddr, u8)],
    /// The tunnel resolvers: the only DNS allowed, and only through a tunnel.
    pub(crate) resolvers: &'a [IpAddr],
    /// LUIDs of the tunnel devices. Empty before the sidecar exists (phase 1),
    /// when only the endpoint, its control API, loopback, DHCP and NDP leave.
    pub(crate) tunnels: &'a [u64],
}

/// The kill switch: everything outbound is blocked except, highest first,
///  15. the WireGuard endpoint (so even a transport on port 53 is never caught),
///      and TCP to the gateway's control API on the endpoint's address,
///  14. DNS to the tunnel resolvers through a tunnel device,
///  13. — every other DNS (also on the LAN-bypass path below),
///  12. loopback (the wg-tls bridge's local side),
///  11. anything through a tunnel device,
///  10. the split-tunnel bypass prefixes,
///   9. DHCP and IPv6 neighbor discovery, so the physical link keeps its
///      lease and its neighbors while blocked,
///   0. — everything else.
pub(crate) fn kill_switch_plan(input: &KillSwitchInput<'_>) -> Vec<FilterSpec> {
    let mut out = vec![filter(
        "CumulusVPN kill switch: WireGuard endpoint",
        Family::of(&input.endpoint),
        15,
        Action::Permit,
        vec![
            Cond::RemoteAddr(input.endpoint),
            Cond::RemotePort(input.endpoint_port),
            Cond::Protocol(input.endpoint_proto),
        ],
    )];
    out.push(filter(
        "CumulusVPN kill switch: gateway control API",
        Family::of(&input.endpoint),
        15,
        Action::Permit,
        vec![
            Cond::RemoteAddr(input.endpoint),
            Cond::RemotePort(input.control_port),
            Cond::Protocol(PROTO_TCP),
        ],
    ));
    for family in BOTH {
        if !input.tunnels.is_empty() {
            let resolvers: Vec<Cond> = input
                .resolvers
                .iter()
                .filter(|r| Family::of(r) == family)
                .map(|r| Cond::RemoteAddr(*r))
                .collect();
            if !resolvers.is_empty() {
                let mut c = dns_match();
                c.extend(resolvers);
                c.extend(input.tunnels.iter().map(|l| Cond::LocalInterface(*l)));
                out.push(filter(
                    "CumulusVPN kill switch: DNS to the tunnel resolver",
                    family,
                    14,
                    Action::Permit,
                    c,
                ));
            }
        }
        out.push(filter(
            "CumulusVPN kill switch: other DNS",
            family,
            13,
            Action::Block,
            dns_match(),
        ));
        out.push(filter(
            "CumulusVPN kill switch: loopback",
            family,
            12,
            Action::Permit,
            vec![Cond::Loopback],
        ));
        if !input.tunnels.is_empty() {
            out.push(filter(
                "CumulusVPN kill switch: tunnel",
                family,
                11,
                Action::Permit,
                input
                    .tunnels
                    .iter()
                    .map(|l| Cond::LocalInterface(*l))
                    .collect(),
            ));
        }
        let bypass: Vec<Cond> = input
            .bypass
            .iter()
            .filter(|(ip, _)| Family::of(ip) == family)
            .map(|(ip, len)| Cond::RemotePrefix(*ip, *len))
            .collect();
        if !bypass.is_empty() {
            out.push(filter(
                "CumulusVPN kill switch: split-tunnel bypass",
                family,
                10,
                Action::Permit,
                bypass,
            ));
        }
        out.push(filter(
            "CumulusVPN kill switch: block",
            family,
            0,
            Action::Block,
            Vec::new(),
        ));
    }
    out.push(filter(
        "CumulusVPN kill switch: DHCP",
        Family::V4,
        9,
        Action::Permit,
        vec![
            Cond::Protocol(PROTO_UDP),
            Cond::LocalPort(68),
            Cond::RemotePort(67),
        ],
    ));
    out.push(filter(
        "CumulusVPN kill switch: DHCPv6",
        Family::V6,
        9,
        Action::Permit,
        vec![
            Cond::Protocol(PROTO_UDP),
            Cond::LocalPort(546),
            Cond::RemotePort(547),
        ],
    ));
    let mut ndp = vec![Cond::Protocol(PROTO_ICMPV6)];
    ndp.extend(NDP_TYPES.iter().map(|t| Cond::LocalPort(*t)));
    out.push(filter(
        "CumulusVPN kill switch: neighbor discovery",
        Family::V6,
        9,
        Action::Permit,
        ndp,
    ));
    out
}

/// The DNS leak block, installed with every tunnel whether or not the kill
/// switch is on. Windows' smart multi-homed resolution asks every adapter's
/// resolver in parallel, so pointing the tunnel adapter at the tunnel resolver
/// is not enough: DNS (UDP/TCP 53, 853) is blocked except, highest first,
///  15. to a WireGuard endpoint (its transport is never caught),
///  14. to the tunnel resolvers through the tunnel device,
///  13. — everything else, both families (the tunnel carries no IPv6).
pub(crate) fn dns_plan(resolvers: &[IpAddr], endpoints: &[IpAddr], tunnel: u64) -> Vec<FilterSpec> {
    let mut out = Vec::new();
    for family in BOTH {
        let eps: Vec<Cond> = endpoints
            .iter()
            .filter(|e| Family::of(e) == family)
            .map(|e| Cond::RemoteAddr(*e))
            .collect();
        if !eps.is_empty() {
            let mut c = dns_match();
            c.extend(eps);
            out.push(filter(
                "CumulusVPN DNS: WireGuard endpoint",
                family,
                15,
                Action::Permit,
                c,
            ));
        }
        let rs: Vec<Cond> = resolvers
            .iter()
            .filter(|r| Family::of(r) == family)
            .map(|r| Cond::RemoteAddr(*r))
            .collect();
        if !rs.is_empty() {
            let mut c = dns_match();
            c.extend(rs);
            c.push(Cond::LocalInterface(tunnel));
            out.push(filter(
                "CumulusVPN DNS: the tunnel resolver",
                family,
                14,
                Action::Permit,
                c,
            ));
        }
        out.push(filter(
            "CumulusVPN DNS: other DNS",
            family,
            13,
            Action::Block,
            dns_match(),
        ));
    }
    out
}

/// A route the stack could use as the default, with what it costs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DefaultRoute {
    pub(crate) next_hop: IpAddr,
    pub(crate) luid: u64,
    /// Route metric plus interface metric: how the stack itself ranks two
    /// default routes (Wi-Fi and Ethernet both up).
    pub(crate) cost: u64,
}

/// The default route the stack would pick: the cheapest, the first on a tie.
/// The tunnel's split-default `/1` pair is never a `/0`, so this keeps naming
/// the physical path while connected.
pub(crate) fn best_default(routes: &[DefaultRoute]) -> Option<DefaultRoute> {
    routes
        .iter()
        .copied()
        .reduce(|best, r| if r.cost < best.cost { r } else { best })
}

/// A route the tunnel created: exactly what it takes to delete that row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RecordedRoute {
    pub(crate) prefix: (IpAddr, u8),
    pub(crate) luid: u64,
    /// `None`: on-link.
    pub(crate) next_hop: Option<IpAddr>,
}

/// The route record file: one route per line,
/// `<prefix>/<len> <luid> <next hop | on-link>`.
pub(crate) fn format_routes(routes: &[RecordedRoute]) -> String {
    routes
        .iter()
        .map(|r| {
            let hop = r
                .next_hop
                .map_or_else(|| "on-link".to_string(), |h| h.to_string());
            format!("{}/{} {} {hop}\n", r.prefix.0, r.prefix.1, r.luid)
        })
        .collect()
}

/// Parse the route record file. A malformed line is returned on its own, so
/// recovery deletes every route it can name and reports the rest.
pub(crate) fn parse_routes(text: &str) -> (Vec<RecordedRoute>, Vec<String>) {
    let mut routes = Vec::new();
    let mut bad = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let parsed = (|| {
            let mut parts = line.split(' ');
            let prefix = parse_prefix(parts.next()?)?;
            let luid = parts.next()?.parse::<u64>().ok()?;
            let next_hop = match parts.next()? {
                "on-link" => None,
                hop => {
                    let hop: IpAddr = hop.parse().ok()?;
                    (hop.is_ipv4() == prefix.0.is_ipv4()).then_some(hop)?;
                    Some(hop)
                }
            };
            parts.next().is_none().then_some(RecordedRoute {
                prefix,
                luid,
                next_hop,
            })
        })();
        match parsed {
            Some(r) => routes.push(r),
            None => bad.push(line.to_string()),
        }
    }
    (routes, bad)
}

/// `a.b.c.d/n` or `x::y/n`. A bare address is a host prefix.
pub(crate) fn parse_prefix(cidr: &str) -> Option<(IpAddr, u8)> {
    let (addr, len) = match cidr.split_once('/') {
        Some((a, l)) => (a, Some(l)),
        None => (cidr, None),
    };
    let ip: IpAddr = addr.parse().ok()?;
    let max = match ip {
        IpAddr::V4(_) => 32,
        IpAddr::V6(_) => 128,
    };
    let len = match len {
        Some(l) => l.parse::<u8>().ok().filter(|l| *l <= max)?,
        None => max,
    };
    Some((ip, len))
}

/// The rule group of one stored Windows Firewall rule
/// (`HKLM\...\FirewallPolicy\FirewallRules`), which records it as a
/// `|`-separated `EmbedCtxt=<group>` field, e.g.
/// `v2.33|Action=Block|Active=TRUE|Dir=Out|RA4=192.0.2.1|Name=x|EmbedCtxt=CumulusVPN-DNS|`.
pub(crate) fn firewall_rule_group(stored: &str) -> Option<&str> {
    stored
        .split('|')
        .find_map(|field| field.strip_prefix("EmbedCtxt="))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    fn v4(s: &str) -> IpAddr {
        IpAddr::V4(s.parse::<Ipv4Addr>().unwrap())
    }
    fn v6(s: &str) -> IpAddr {
        IpAddr::V6(s.parse::<Ipv6Addr>().unwrap())
    }

    fn input<'a>(
        tunnels: &'a [u64],
        resolvers: &'a [IpAddr],
        bypass: &'a [(IpAddr, u8)],
    ) -> KillSwitchInput<'a> {
        KillSwitchInput {
            endpoint: v4("203.0.113.7"),
            endpoint_port: 51820,
            endpoint_proto: PROTO_UDP,
            control_port: 51821,
            bypass,
            resolvers,
            tunnels,
        }
    }

    /// The decision WFP would make for one connection in one sublayer: the
    /// highest-weight filter whose conditions all match (fields ANDed, values
    /// of one field ORed), or permit when none matches.
    #[derive(Default, Clone, Copy)]
    struct Conn {
        v6: bool,
        remote: Option<IpAddr>,
        remote_port: u16,
        local_port: u16,
        proto: u8,
        iface: u64,
        loopback: bool,
    }

    fn in_prefix(ip: IpAddr, net: IpAddr, len: u8) -> bool {
        match (ip, net) {
            (IpAddr::V4(a), IpAddr::V4(n)) => {
                let mask = if len == 0 { 0 } else { u32::MAX << (32 - len) };
                u32::from(a) & mask == u32::from(n) & mask
            }
            (IpAddr::V6(a), IpAddr::V6(n)) => {
                let mask = if len == 0 {
                    0
                } else {
                    u128::MAX << (128 - len)
                };
                u128::from(a) & mask == u128::from(n) & mask
            }
            _ => false,
        }
    }

    fn matches(f: &FilterSpec, c: &Conn) -> bool {
        if (f.family == Family::V6) != c.v6 {
            return false;
        }
        let field = |k: u8| -> Option<bool> {
            let of: Vec<&Cond> = f
                .conds
                .iter()
                .filter(|x| {
                    k == match x {
                        Cond::RemoteAddr(_) | Cond::RemotePrefix(..) => 0,
                        Cond::RemotePort(_) => 1,
                        Cond::LocalPort(_) => 2,
                        Cond::Protocol(_) => 3,
                        Cond::LocalInterface(_) => 4,
                        Cond::Loopback => 5,
                    }
                })
                .collect();
            if of.is_empty() {
                return None;
            }
            Some(of.iter().any(|x| match **x {
                Cond::RemoteAddr(a) => c.remote == Some(a),
                Cond::RemotePrefix(n, l) => c.remote.is_some_and(|r| in_prefix(r, n, l)),
                Cond::RemotePort(p) => c.remote_port == p,
                Cond::LocalPort(p) => c.local_port == p,
                Cond::Protocol(p) => c.proto == p,
                Cond::LocalInterface(l) => c.iface == l,
                Cond::Loopback => c.loopback,
            }))
        };
        (0..6).all(|k| field(k) != Some(false))
    }

    fn decide(plan: &[FilterSpec], c: &Conn) -> Action {
        plan.iter()
            .filter(|f| matches(f, c))
            .max_by_key(|f| f.weight)
            .map(|f| f.action)
            .unwrap_or(Action::Permit)
    }

    const TUN: u64 = 0x1111;
    const WIFI: u64 = 0x2222;

    #[test]
    fn the_endpoint_and_the_tunnel_pass_and_the_physical_link_does_not() {
        let resolvers = [v4("1.1.1.1")];
        let plan = kill_switch_plan(&input(&[TUN], &resolvers, &[]));
        let endpoint = Conn {
            remote: Some(v4("203.0.113.7")),
            remote_port: 51820,
            proto: PROTO_UDP,
            iface: WIFI,
            ..Default::default()
        };
        assert_eq!(decide(&plan, &endpoint), Action::Permit);
        // The same host on another port or protocol is not the endpoint.
        assert_eq!(
            decide(
                &plan,
                &Conn {
                    remote_port: 443,
                    proto: PROTO_TCP,
                    ..endpoint
                }
            ),
            Action::Block
        );
        let web = Conn {
            remote: Some(v4("93.184.216.34")),
            remote_port: 443,
            proto: PROTO_TCP,
            ..Default::default()
        };
        assert_eq!(decide(&plan, &Conn { iface: TUN, ..web }), Action::Permit);
        assert_eq!(decide(&plan, &Conn { iface: WIFI, ..web }), Action::Block);
        assert_eq!(
            decide(
                &plan,
                &Conn {
                    v6: true,
                    remote: Some(v6("2606:4700::1")),
                    iface: WIFI,
                    ..web
                }
            ),
            Action::Block
        );
        assert_eq!(
            decide(
                &plan,
                &Conn {
                    loopback: true,
                    ..web
                }
            ),
            Action::Permit
        );
    }

    /// Phase 1 runs before the sidecar exists: only the endpoint and its control
    /// API, loopback, DHCP and NDP leave.
    #[test]
    fn phase_one_allows_only_the_endpoint() {
        let resolvers = [v4("1.1.1.1")];
        let plan = kill_switch_plan(&input(&[], &resolvers, &[]));
        assert!(plan
            .iter()
            .all(|f| !f.conds.iter().any(|c| matches!(c, Cond::LocalInterface(_)))));
        let dns = Conn {
            remote: Some(v4("1.1.1.1")),
            remote_port: 53,
            proto: PROTO_UDP,
            iface: WIFI,
            ..Default::default()
        };
        assert_eq!(decide(&plan, &dns), Action::Block);
    }

    #[test]
    fn dns_goes_only_to_the_tunnel_resolver_through_the_tunnel() {
        let resolvers = [v4("1.1.1.1")];
        let bypass = [(v4("192.168.0.0"), 16)];
        let plan = kill_switch_plan(&input(&[TUN], &resolvers, &bypass));
        let q = |remote: &str, iface: u64, port: u16, proto: u8| Conn {
            remote: Some(v4(remote)),
            remote_port: port,
            proto,
            iface,
            ..Default::default()
        };
        assert_eq!(
            decide(&plan, &q("1.1.1.1", TUN, 53, PROTO_UDP)),
            Action::Permit
        );
        assert_eq!(
            decide(&plan, &q("1.1.1.1", TUN, 853, PROTO_TCP)),
            Action::Permit
        );
        // Through the tunnel, but to another server.
        assert_eq!(
            decide(&plan, &q("8.8.8.8", TUN, 53, PROTO_UDP)),
            Action::Block
        );
        // The right server, but out the physical link.
        assert_eq!(
            decide(&plan, &q("1.1.1.1", WIFI, 53, PROTO_UDP)),
            Action::Block
        );
        // The router: inside the LAN bypass, which must not reopen DNS.
        assert_eq!(
            decide(&plan, &q("192.168.1.1", WIFI, 53, PROTO_UDP)),
            Action::Block
        );
        assert_eq!(
            decide(&plan, &q("192.168.1.1", WIFI, 445, PROTO_TCP)),
            Action::Permit
        );
    }

    #[test]
    fn a_transport_on_port_53_is_never_caught_by_the_dns_block() {
        let plan = kill_switch_plan(&KillSwitchInput {
            endpoint_port: 53,
            ..input(&[TUN], &[], &[])
        });
        let c = Conn {
            remote: Some(v4("203.0.113.7")),
            remote_port: 53,
            proto: PROTO_UDP,
            iface: WIFI,
            ..Default::default()
        };
        assert_eq!(decide(&plan, &c), Action::Permit);
    }

    /// The app's requests to its gateway's control API leave by the physical
    /// link (the endpoint pin) and pass; UDP to that port, or the control port
    /// on another host, do not.
    #[test]
    fn the_gateway_control_api_passes_and_nothing_beside_it() {
        let plan = kill_switch_plan(&input(&[TUN], &[], &[]));
        let api = Conn {
            remote: Some(v4("203.0.113.7")),
            remote_port: 51821,
            proto: PROTO_TCP,
            iface: WIFI,
            ..Default::default()
        };
        assert_eq!(decide(&plan, &api), Action::Permit);
        assert_eq!(
            decide(
                &plan,
                &Conn {
                    proto: PROTO_UDP,
                    ..api
                }
            ),
            Action::Block
        );
        assert_eq!(
            decide(
                &plan,
                &Conn {
                    remote: Some(v4("198.51.100.9")),
                    ..api
                }
            ),
            Action::Block
        );
        // Phase 1 too: the app may ask before the tunnel is up.
        let phase1 = kill_switch_plan(&input(&[], &[], &[]));
        assert_eq!(decide(&phase1, &api), Action::Permit);
    }

    #[test]
    fn the_physical_link_keeps_its_lease_and_neighbors() {
        let plan = kill_switch_plan(&input(&[TUN], &[], &[]));
        let dhcp = Conn {
            remote: Some(v4("255.255.255.255")),
            local_port: 68,
            remote_port: 67,
            proto: PROTO_UDP,
            iface: WIFI,
            ..Default::default()
        };
        assert_eq!(decide(&plan, &dhcp), Action::Permit);
        let ns = Conn {
            v6: true,
            remote: Some(v6("ff02::1:ff00:1")),
            local_port: 135,
            proto: PROTO_ICMPV6,
            iface: WIFI,
            ..Default::default()
        };
        assert_eq!(decide(&plan, &ns), Action::Permit);
        // An echo request (type 128) is ordinary traffic.
        assert_eq!(
            decide(
                &plan,
                &Conn {
                    local_port: 128,
                    ..ns
                }
            ),
            Action::Block
        );
    }

    #[test]
    fn the_dns_block_allows_only_the_tunnel_resolver_through_the_tunnel() {
        let resolvers = [v4("9.9.9.9"), v4("149.112.112.112")];
        let plan = dns_plan(&resolvers, &[v4("203.0.113.7")], TUN);
        let q = |remote: &str, iface: u64| Conn {
            remote: Some(v4(remote)),
            remote_port: 53,
            proto: PROTO_UDP,
            iface,
            ..Default::default()
        };
        assert_eq!(decide(&plan, &q("9.9.9.9", TUN)), Action::Permit);
        assert_eq!(decide(&plan, &q("149.112.112.112", TUN)), Action::Permit);
        assert_eq!(decide(&plan, &q("9.9.9.9", WIFI)), Action::Block);
        assert_eq!(decide(&plan, &q("192.168.1.1", WIFI)), Action::Block);
        assert_eq!(decide(&plan, &q("203.0.113.7", WIFI)), Action::Permit);
        // Not DNS: untouched (no kill switch here).
        assert_eq!(
            decide(
                &plan,
                &Conn {
                    remote_port: 443,
                    proto: PROTO_TCP,
                    ..q("192.168.1.1", WIFI)
                }
            ),
            Action::Permit
        );
        // IPv6 DNS goes nowhere: the tunnel carries no IPv6.
        assert_eq!(
            decide(
                &plan,
                &Conn {
                    v6: true,
                    remote: Some(v6("2620:fe::fe")),
                    remote_port: 53,
                    proto: PROTO_UDP,
                    iface: WIFI,
                    ..Default::default()
                }
            ),
            Action::Block
        );
    }

    #[test]
    fn weights_fit_the_wfp_range_and_every_block_has_a_family() {
        let resolvers = [v4("1.1.1.1"), v6("2606:4700:4700::1111")];
        let bypass = [(v4("10.0.0.0"), 8), (v6("fd00::"), 8)];
        for plan in [
            kill_switch_plan(&input(&[TUN], &resolvers, &bypass)),
            dns_plan(&resolvers, &[v4("203.0.113.7")], TUN),
        ] {
            assert!(plan.iter().all(|f| f.weight <= 15));
            for fam in BOTH {
                assert!(plan
                    .iter()
                    .any(|f| f.family == fam && f.action == Action::Block));
            }
        }
    }

    #[test]
    fn the_cheapest_default_route_wins_and_ties_keep_the_first() {
        let r = |hop: &str, luid: u64, cost: u64| DefaultRoute {
            next_hop: v4(hop),
            luid,
            cost,
        };
        assert_eq!(best_default(&[]), None);
        let wifi = r("192.168.1.1", 1, 35);
        let eth = r("10.0.0.1", 2, 25);
        assert_eq!(best_default(&[wifi, eth]), Some(eth));
        assert_eq!(best_default(&[wifi, r("10.0.0.1", 2, 35)]), Some(wifi));
    }

    #[test]
    fn prefixes_parse_with_and_without_a_length() {
        assert_eq!(
            parse_prefix("192.168.0.0/16"),
            Some((v4("192.168.0.0"), 16))
        );
        assert_eq!(parse_prefix("203.0.113.7"), Some((v4("203.0.113.7"), 32)));
        assert_eq!(parse_prefix("fe80::/10"), Some((v6("fe80::"), 10)));
        assert_eq!(parse_prefix("::/1"), Some((v6("::"), 1)));
        for bad in [
            "",
            "10.0.0.0/33",
            "fe80::/129",
            "10.0.0/8",
            "10.0.0.0/x",
            "a b/8",
        ] {
            assert_eq!(parse_prefix(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_route_record_round_trips() {
        let routes = [
            RecordedRoute {
                prefix: (v4("49.12.156.231"), 32),
                luid: 1_688_849_860_263_936,
                next_hop: Some(v4("10.58.132.114")),
            },
            RecordedRoute {
                prefix: (v4("0.0.0.0"), 1),
                luid: 42,
                next_hop: None,
            },
            RecordedRoute {
                prefix: (v6("8000::"), 1),
                luid: 42,
                next_hop: None,
            },
        ];
        let text = format_routes(&routes);
        assert_eq!(
            text,
            "49.12.156.231/32 1688849860263936 10.58.132.114\n0.0.0.0/1 42 on-link\n8000::/1 42 on-link\n"
        );
        assert_eq!(parse_routes(&text), (routes.to_vec(), Vec::new()));
        assert_eq!(parse_routes(""), (Vec::new(), Vec::new()));
    }

    /// Every line that names a route is used; every other line is reported.
    #[test]
    fn malformed_route_lines_are_reported_and_the_rest_kept() {
        let text = "0.0.0.0/1 42 on-link\n\
                    10.0.0.0/33 42 on-link\n\
                    0.0.0.0/1 x on-link\n\
                    0.0.0.0/1 42\n\
                    0.0.0.0/1 42 on-link extra\n\
                    203.0.113.7/32 42 fe80::1\n\
                    128.0.0.0/1 42 on-link\n";
        let (routes, bad) = parse_routes(text);
        assert_eq!(
            routes.iter().map(|r| r.prefix).collect::<Vec<_>>(),
            vec![(v4("0.0.0.0"), 1), (v4("128.0.0.0"), 1)]
        );
        assert_eq!(bad.len(), 5, "{bad:?}");
    }

    /// The exact record Windows stored for a `-Group 'CumulusVPN-DNS'` rule on
    /// this project's Windows 11 test machine, and one of its own rules.
    #[test]
    fn the_stored_rule_group_is_read_from_its_own_field() {
        assert_eq!(
            firewall_rule_group(
                "v2.33|Action=Block|Active=TRUE|Dir=Out|RA4=192.0.2.1|Name=CumulusVPN probe|EmbedCtxt=CumulusVPN-DNS|"
            ),
            Some("CumulusVPN-DNS")
        );
        assert_eq!(
            firewall_rule_group(
                "v2.10|Action=Allow|Active=TRUE|Dir=In|Protocol=6|Profile=Public|App=C:\\x\\wireguard-go.exe|Name=wireguard-go.exe|Desc=wireguard-go.exe|Defer=User|"
            ),
            None
        );
        // A name that merely mentions the group is not membership.
        assert_eq!(
            firewall_rule_group("v2.33|Action=Allow|Name=EmbedCtxt=CumulusVPN|"),
            None
        );
    }
}
