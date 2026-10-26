//! Shape checks for the requests that cross the privilege boundary.
//!
//! Every field of a [`ConnectRequest`], [`MultihopEntryRequest`] or
//! [`MultihopExitRequest`] ends up somewhere
//! a privileged process interprets text: the pf anchor and the nftables table
//! (`killswitch`), PowerShell scripts running as SYSTEM (`killswitch`, `dns`,
//! `routing` on Windows), `ip` / `route` / `netsh` argv, the wireguard-go UAPI.
//! An endpoint of `1.2.3.4 } accept` would be spliced into the nft table, and
//! `1.2.3.4; Remove-Item …` into a PowerShell command line.
//!
//! On macOS the only peer the helper serves is our own signed app. On Linux and
//! Windows the boundary is wider: any process of a user allowed to drive the
//! VPN that is running the installed app binary (see the helper's peer
//! authentication), and an app process can be tampered with by its own user.
//! So the daemon does not trust the shape of what it is sent. Each field must
//! parse as exactly what it claims to be (an IP literal, a socket address, a
//! CIDR prefix) before anything is touched; a refused request leaves the tunnel
//! as it was.
//!
//! [`crate::wggo::WgConfig::parse`] applies the same rule to the fields inside
//! the `.conf` text.

use std::net::{IpAddr, SocketAddr};

use cumulusvpn_protocol::{
    ConnectRequest, MultihopEntryRequest, MultihopExitRequest, SplitParams, TlsParams,
};

use super::TunnelError;

/// Longest WireGuard `.conf` accepted. The real ones are well under 1 KiB.
const MAX_CONFIG_LEN: usize = 16 * 1024;

/// Most prefixes accepted in one split-tunneling route list. A compiled policy
/// is a few dozen; this only bounds how much route and firewall work one
/// request can ask for.
const MAX_ROUTES: usize = 4096;

/// Longest label (country) accepted. They are ISO codes; this is generous.
const MAX_LABEL_LEN: usize = 64;

/// Most resolvers accepted on one `DNS =` line. The apps send one (the
/// gateway's) or two (a Settings → DNS provider); this only bounds how many
/// firewall exceptions one config can ask for.
const MAX_DNS_SERVERS: usize = 8;

/// Interface MTU bounds for the multi-hop inner device (IPv4 minimum to jumbo).
const MTU_RANGE: std::ops::RangeInclusive<u16> = 576..=9200;

/// Check a single-hop request before any of it is acted on.
pub fn connect_request(r: &ConnectRequest) -> Result<(), TunnelError> {
    label(&r.country)?;
    config_text(&r.wg_config)?;
    endpoint(&r.endpoint)?;
    assigned_ip(&r.assigned_ip)?;
    if let Some(tls) = &r.tls {
        tls_params(tls)?;
    }
    if let Some(split) = &r.split {
        split_params(split)?;
    }
    Ok(())
}

/// Check a multi-hop entry request before any of it is acted on.
pub fn multihop_entry_request(r: &MultihopEntryRequest) -> Result<(), TunnelError> {
    label(&r.entry_country)?;
    config_text(&r.outer)?;
    endpoint(&r.entry_endpoint)?;
    endpoint(&r.exit_endpoint)?;
    if let Some(split) = &r.split {
        split_params(split)?;
    }
    Ok(())
}

/// Check a multi-hop exit request before any of it is acted on.
pub fn multihop_exit_request(r: &MultihopExitRequest) -> Result<(), TunnelError> {
    label(&r.exit_country)?;
    config_text(&r.inner)?;
    endpoint(&r.entry_endpoint)?;
    endpoint(&r.exit_endpoint)?;
    if !MTU_RANGE.contains(&r.inner_mtu) {
        return Err(TunnelError::BadConfig("inner MTU out of range"));
    }
    assigned_ip(&r.assigned_ip)?;
    if let Some(split) = &r.split {
        split_params(split)?;
    }
    Ok(())
}

/// A display label: short, and no control characters (it is echoed in status
/// and log lines, never into a command).
fn label(s: &str) -> Result<(), TunnelError> {
    if s.len() > MAX_LABEL_LEN || s.chars().any(char::is_control) {
        return Err(TunnelError::BadConfig("invalid country"));
    }
    Ok(())
}

fn config_text(s: &str) -> Result<(), TunnelError> {
    if s.len() > MAX_CONFIG_LEN {
        return Err(TunnelError::BadConfig("config too large"));
    }
    Ok(())
}

/// `ip:port`, with the IP a literal. This is what the kill switch allow-lists
/// and the endpoint bypass routes, so it is the field that most needs to be
/// exactly an address.
pub(crate) fn endpoint(s: &str) -> Result<SocketAddr, TunnelError> {
    s.parse::<SocketAddr>()
        .map_err(|_| TunnelError::BadConfig("endpoint must be an ip:port literal"))
}

/// The tunnel address, optionally with a prefix length (`10.8.0.2` or
/// `10.8.0.2/32`).
fn assigned_ip(s: &str) -> Result<(), TunnelError> {
    let (ip, prefix) = match s.split_once('/') {
        Some((ip, prefix)) => (ip, Some(prefix)),
        None => (s, None),
    };
    let ip: IpAddr = ip
        .parse()
        .map_err(|_| TunnelError::BadConfig("assigned ip is not an address"))?;
    if let Some(prefix) = prefix {
        prefix_len(ip, prefix)?;
    }
    Ok(())
}

/// A CIDR prefix (`10.0.0.0/8`, `fe80::/10`) or a bare address.
pub(crate) fn cidr(s: &str) -> Result<(), TunnelError> {
    let (ip, prefix) = match s.split_once('/') {
        Some((ip, prefix)) => (ip, Some(prefix)),
        None => (s, None),
    };
    let ip: IpAddr = ip
        .parse()
        .map_err(|_| TunnelError::BadConfig("route is not an address prefix"))?;
    if let Some(prefix) = prefix {
        prefix_len(ip, prefix)?;
    }
    Ok(())
}

/// A `.conf` `DNS =` value: IP literals, comma-separated, as in
/// `DNS = 9.9.9.9, 149.112.112.112`. Spaces and empty entries are tolerated;
/// a hostname, a search domain or anything else is refused, as is a list too
/// long to be real. The addresses reach the pf anchor, the nftables table and
/// PowerShell (typed, via `dns::parse_servers`); refusing here means a bad line
/// fails the connect up front instead of quietly leaving the tunnel with fewer
/// resolvers than it was given. An empty value is accepted: the DNS session
/// reports "no DNS server" and the kill switch blocks all DNS.
pub(crate) fn dns_servers(s: &str) -> Result<(), TunnelError> {
    let mut count = 0;
    for entry in s.split(',').map(str::trim).filter(|e| !e.is_empty()) {
        entry
            .parse::<IpAddr>()
            .map_err(|_| TunnelError::BadConfig("DNS must list IP addresses"))?;
        count += 1;
    }
    if count > MAX_DNS_SERVERS {
        return Err(TunnelError::BadConfig("too many DNS servers"));
    }
    Ok(())
}

fn prefix_len(ip: IpAddr, prefix: &str) -> Result<(), TunnelError> {
    let max = if ip.is_ipv4() { 32 } else { 128 };
    // `u8::from_str` accepts a leading `+`; nothing but digits may reach a rule.
    if prefix.is_empty() || !prefix.bytes().all(|b| b.is_ascii_digit()) {
        return Err(TunnelError::BadConfig("invalid prefix length"));
    }
    match prefix.parse::<u8>() {
        Ok(n) if n <= max => Ok(()),
        _ => Err(TunnelError::BadConfig("invalid prefix length")),
    }
}

fn tls_params(tls: &TlsParams) -> Result<(), TunnelError> {
    endpoint(&tls.server_addr)?;
    // Only rustls sees the SNI (it is camouflage, never verified), and it
    // rejects anything that is not a name or an address. Bound it anyway.
    let sni_ok = !tls.sni.is_empty()
        && tls.sni.len() <= 253
        && tls
            .sni
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':'));
    if !sni_ok {
        return Err(TunnelError::BadConfig("invalid TLS server name"));
    }
    Ok(())
}

fn split_params(split: &SplitParams) -> Result<(), TunnelError> {
    for list in [&split.bypass_routes, &split.tunnel_routes] {
        if list.len() > MAX_ROUTES {
            return Err(TunnelError::BadConfig("too many split-tunneling routes"));
        }
        for route in list {
            cidr(route)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    fn conf() -> String {
        format!(
            "[Interface]\nPrivateKey = {KEY}\nAddress = 10.8.0.2/32\nDNS = 1.1.1.1\n\n\
             [Peer]\nPublicKey = {KEY}\nEndpoint = 203.0.113.7:51820\n\
             AllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n"
        )
    }

    fn request() -> ConnectRequest {
        ConnectRequest {
            country: "DE".into(),
            wg_config: conf(),
            endpoint: "203.0.113.7:51820".into(),
            assigned_ip: "10.8.0.2".into(),
            kill_switch: true,
            tls: None,
            split: None,
        }
    }

    #[test]
    fn a_real_request_passes() {
        assert!(connect_request(&request()).is_ok());
        let mut with_prefix = request();
        with_prefix.assigned_ip = "10.8.0.2/32".into();
        assert!(connect_request(&with_prefix).is_ok());
        let mut stealth = request();
        stealth.tls = Some(TlsParams {
            server_addr: "203.0.113.7:443".into(),
            sni: "www.example.com".into(),
        });
        stealth.split = Some(SplitParams {
            bypass_routes: vec!["192.168.0.0/16".into(), "fe80::/10".into()],
            tunnel_routes: vec![],
        });
        assert!(connect_request(&stealth).is_ok());
    }

    /// The endpoint is interpolated into the nft table, the pf anchor and a
    /// PowerShell command running as SYSTEM. Each of these would have been
    /// spliced into one of them.
    #[test]
    fn an_endpoint_that_is_not_an_address_is_refused() {
        for bad in [
            "203.0.113.7 } accept; #:51820",
            "203.0.113.7; Remove-Item C:\\ -Recurse:51820",
            "$(reboot):51820",
            "gateway.example.com:51820",
            "203.0.113.7:51820\nblock",
            "203.0.113.7",
            "",
        ] {
            let mut r = request();
            r.endpoint = bad.into();
            assert!(connect_request(&r).is_err(), "accepted endpoint {bad:?}");
        }
    }

    #[test]
    fn split_routes_must_be_prefixes() {
        for bad in [
            "10.0.0.0/8 accept",
            "10.0.0.0/33",
            "10.0.0.0/+8",
            "fe80::/129",
            "10.0.0.0/",
            "'; Remove-NetRoute",
        ] {
            let mut r = request();
            r.split = Some(SplitParams {
                bypass_routes: vec![bad.into()],
                tunnel_routes: vec![],
            });
            assert!(connect_request(&r).is_err(), "accepted route {bad:?}");
        }
        let mut r = request();
        r.split = Some(SplitParams {
            bypass_routes: vec![],
            tunnel_routes: vec!["10.0.0.0/8".into(); MAX_ROUTES + 1],
        });
        assert!(
            connect_request(&r).is_err(),
            "unbounded route list accepted"
        );
    }

    #[test]
    fn tls_parameters_are_checked() {
        let mut r = request();
        r.tls = Some(TlsParams {
            server_addr: "relay.example.com:443".into(),
            sni: "www.example.com".into(),
        });
        assert!(connect_request(&r).is_err(), "relay must be a literal");
        r.tls = Some(TlsParams {
            server_addr: "203.0.113.7:443".into(),
            sni: "www.example.com\n".into(),
        });
        assert!(
            connect_request(&r).is_err(),
            "control characters in the SNI"
        );
    }

    #[test]
    fn labels_and_addresses_are_bounded() {
        let mut r = request();
        r.country = "D\nE".into();
        assert!(connect_request(&r).is_err());
        let mut r = request();
        r.assigned_ip = "10.8.0.2/32; ls".into();
        assert!(connect_request(&r).is_err());
        let mut r = request();
        r.wg_config = "x".repeat(MAX_CONFIG_LEN + 1);
        assert!(connect_request(&r).is_err());
    }

    /// Settings → DNS lists: every provider's pair, however it is spaced.
    #[test]
    fn dns_provider_lists_are_accepted() {
        for good in [
            "1.1.1.1",
            "1.1.1.1, 1.0.0.1",
            "9.9.9.9, 149.112.112.112",
            "94.140.14.14,94.140.15.15",
            " 1.1.1.3 ,  1.0.0.3 ,",
            "2606:4700:4700::1111, 1.1.1.1",
            "",
        ] {
            assert!(dns_servers(good).is_ok(), "refused DNS {good:?}");
        }
    }

    /// Anything but addresses is refused — a server can never be dropped
    /// silently, or smuggled into a rule.
    #[test]
    fn dns_lists_that_are_not_addresses_are_refused() {
        for bad in [
            "1.1.1.1; reboot",
            "9.9.9.9 149.112.112.112",
            "9.9.9.9, 1.2.3.4 } accept",
            "1.1.1.1, $(reboot)",
            "dns.quad9.net",
            "1.1.1.1, corp.example",
            "1.1.1.1:53",
            "999.1.1.1",
            "1.1.1.1\nblock",
        ] {
            assert!(dns_servers(bad).is_err(), "accepted DNS {bad:?}");
        }
        let many = ["9.9.9.9"; MAX_DNS_SERVERS + 1].join(", ");
        assert!(dns_servers(&many).is_err(), "unbounded DNS list accepted");
        let most = ["9.9.9.9"; MAX_DNS_SERVERS].join(", ");
        assert!(dns_servers(&most).is_ok());
    }

    #[test]
    fn multihop_requests_are_checked_the_same_way() {
        let entry = MultihopEntryRequest {
            entry_country: "DE".into(),
            outer: conf(),
            entry_endpoint: "203.0.113.7:51820".into(),
            exit_endpoint: "198.51.100.9:51820".into(),
            kill_switch: true,
            split: None,
        };
        assert!(multihop_entry_request(&entry).is_ok());
        let mut bad = entry.clone();
        bad.exit_endpoint = "198.51.100.9 accept:51820".into();
        assert!(multihop_entry_request(&bad).is_err());
        let mut bad = entry.clone();
        bad.entry_country = "DE\n".into();
        assert!(multihop_entry_request(&bad).is_err());

        let exit = MultihopExitRequest {
            exit_country: "NL".into(),
            inner: conf(),
            entry_endpoint: "203.0.113.7:51820".into(),
            exit_endpoint: "198.51.100.9:51820".into(),
            inner_mtu: 1340,
            assigned_ip: "10.9.0.2".into(),
            kill_switch: true,
            split: None,
        };
        assert!(multihop_exit_request(&exit).is_ok());
        let mut bad = exit.clone();
        bad.entry_endpoint = "203.0.113.7".into();
        assert!(multihop_exit_request(&bad).is_err());
        let mut bad = exit.clone();
        bad.inner_mtu = 0;
        assert!(multihop_exit_request(&bad).is_err());
    }
}
