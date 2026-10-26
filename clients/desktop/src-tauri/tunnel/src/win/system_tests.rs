//! The Windows backend against the real stack: the filtering engine, the
//! routing table, the firewall rule store and live processes. They change the
//! machine (briefly), need an elevated prompt, and run one at a time:
//!
//! ```text
//! cargo test -p cumulusvpn-tunnel -- --ignored --test-threads=1
//! ```
//!
//! Every test that installs filters holds a guard that clears them on drop, so
//! a failing assertion leaves the machine unblocked. Addresses are public
//! anycast resolvers and TEST-NET-1 (192.0.2.0/24).

use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::process::Command;
use std::time::Duration;

use super::plan::{self, KillSwitchInput, PROTO_TCP};
use super::{legacy, net, process, wfp};

const TIMEOUT: Duration = Duration::from_secs(3);

fn v4(s: &str) -> IpAddr {
    IpAddr::V4(s.parse::<Ipv4Addr>().unwrap())
}

/// Clears a sublayer when dropped, pass or fail.
struct Cleared(wfp::Sublayer);

impl Drop for Cleared {
    fn drop(&mut self) {
        wfp::clear(self.0).expect("clear on drop");
    }
}

fn tcp_connects(ip: &str, port: u16) -> bool {
    TcpStream::connect_timeout(&SocketAddr::new(v4(ip), port), TIMEOUT).is_ok()
}

/// A real query (example.com A) to `server:53`; true when an answer comes back.
fn dns_answers(server: &str) -> bool {
    let sock = UdpSocket::bind("0.0.0.0:0").unwrap();
    sock.set_read_timeout(Some(TIMEOUT)).unwrap();
    let query: [u8; 29] = [
        0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 7, b'e', b'x',
        b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0, 0x00, 0x01, 0x00, 0x01,
    ];
    if sock.send_to(&query, (server, 53)).is_err() {
        return false;
    }
    let mut buf = [0u8; 512];
    matches!(sock.recv_from(&mut buf), Ok((n, _)) if n > 12 && buf[0] == 0x12 && buf[1] == 0x34)
}

#[test]
#[ignore = "needs an elevated prompt"]
fn an_elevated_process_is_not_local_system() {
    assert!(
        !process::is_local_system(),
        "an elevated test process is not LocalSystem"
    );
}

#[test]
#[ignore = "needs a network"]
fn the_default_route_is_found() {
    let gw = net::default_route_v4()
        .expect("route table")
        .expect("a default route");
    assert!(gw.next_hop.is_ipv4(), "{gw:?}");
    assert_ne!(gw.next_hop, v4("0.0.0.0"), "{gw:?}");
}

/// The kill switch blocks a new connection anywhere but the endpoint and
/// loopback, and lifting it restores them — on the live engine.
#[test]
#[ignore = "changes the machine's filters; needs an elevated prompt"]
fn the_kill_switch_blocks_all_but_the_endpoint_and_lifts_cleanly() {
    assert!(
        tcp_connects("1.0.0.1", 443),
        "precondition: the network is up"
    );
    let local = TcpListener::bind("127.0.0.1:0").unwrap();
    let local_port = local.local_addr().unwrap().port();

    let specs = plan::kill_switch_plan(&KillSwitchInput {
        endpoint: v4("1.1.1.1"),
        endpoint_port: 443,
        endpoint_proto: PROTO_TCP,
        // A port 1.1.1.1 serves, standing in for the gateway's control API.
        control_port: 80,
        bypass: &[],
        resolvers: &[],
        tunnels: &[],
    });
    {
        let _guard = Cleared(wfp::Sublayer::KillSwitch);
        wfp::replace(wfp::Sublayer::KillSwitch, &specs).expect("engage");
        assert_eq!(wfp::count(wfp::Sublayer::KillSwitch).unwrap(), specs.len());
        // Replacing again leaves the same set, not a second copy.
        wfp::replace(wfp::Sublayer::KillSwitch, &specs).expect("re-engage");
        assert_eq!(wfp::count(wfp::Sublayer::KillSwitch).unwrap(), specs.len());

        assert!(tcp_connects("1.1.1.1", 443), "the endpoint passes");
        assert!(
            tcp_connects("1.1.1.1", 80),
            "the control API on the endpoint passes"
        );
        assert!(!tcp_connects("1.0.0.1", 443), "everything else is blocked");
        assert!(
            !tcp_connects("1.0.0.1", 80),
            "the control port elsewhere too"
        );
        assert!(tcp_connects("127.0.0.1", local_port), "loopback passes");
    }
    assert_eq!(wfp::count(wfp::Sublayer::KillSwitch).unwrap(), 0);
    assert!(tcp_connects("1.0.0.1", 443), "lifted");
}

/// The DNS block stops lookups everywhere but the tunnel resolver through the
/// tunnel, and touches nothing that is not DNS.
#[test]
#[ignore = "changes the machine's filters; needs an elevated prompt"]
fn the_dns_block_stops_other_resolvers_and_nothing_else() {
    assert!(dns_answers("8.8.8.8"), "precondition: DNS works");
    // No interface has LUID 1, so no query qualifies as "through the tunnel".
    let specs = plan::dns_plan(&[v4("1.1.1.1")], &[], 1);
    {
        let _guard = Cleared(wfp::Sublayer::Dns);
        wfp::replace(wfp::Sublayer::Dns, &specs).expect("engage");
        assert!(!dns_answers("8.8.8.8"), "another resolver is blocked");
        assert!(
            !dns_answers("1.1.1.1"),
            "the resolver outside the tunnel is blocked"
        );
        assert!(tcp_connects("8.8.8.8", 443), "other traffic passes");
    }
    assert_eq!(wfp::count(wfp::Sublayer::Dns).unwrap(), 0);
    assert!(dns_answers("8.8.8.8"), "lifted");
}

/// Routes we add are removed exactly; a route that was already there is the
/// system's and stays.
#[test]
#[ignore = "changes the routing table; needs an elevated prompt"]
fn only_routes_we_created_are_removed() {
    let gw = net::default_route_v4().unwrap().expect("a default route");
    let ours = (v4("192.0.2.77"), 32);
    net::add_route(ours, gw.luid, Some(gw.next_hop), net::Scope::Physical).expect("add");
    assert!(net::route_present(ours, gw.luid));
    // Adding it again is a no-op and records nothing twice.
    net::add_route(ours, gw.luid, Some(gw.next_hop), net::Scope::Physical).expect("add again");
    assert_eq!(net::our_routes().iter().filter(|r| r.0 == ours).count(), 1);
    net::remove_routes(ours);
    assert!(!net::route_present(ours, gw.luid));

    // A route someone else made, with the same prefix and next hop.
    let theirs = (v4("192.0.2.78"), 32);
    let alias = net::alias_of(gw.luid);
    let added = Command::new("netsh")
        .args([
            "interface",
            "ipv4",
            "add",
            "route",
            "192.0.2.78/32",
            &alias,
            &gw.next_hop.to_string(),
        ])
        .status()
        .unwrap();
    assert!(added.success(), "netsh add route via {alias}");
    net::add_route(theirs, gw.luid, Some(gw.next_hop), net::Scope::Physical)
        .expect("already there");
    net::remove_routes(theirs);
    let survived = net::route_present(theirs, gw.luid);
    let _ = Command::new("netsh")
        .args([
            "interface",
            "ipv4",
            "delete",
            "route",
            "192.0.2.78/32",
            &alias,
            &gw.next_hop.to_string(),
        ])
        .status();
    assert!(survived, "a route we did not create stays");
}

/// Rule groups in the firewall store are found by their group, and removed.
#[test]
#[ignore = "changes the firewall rules; needs an elevated prompt"]
fn rule_groups_in_the_firewall_store_are_found_and_removed() {
    assert!(
        !legacy::present().dns,
        "precondition: no CumulusVPN-DNS rules"
    );
    let made = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "New-NetFirewallRule -DisplayName 'CumulusVPN test' -Group 'CumulusVPN-DNS' \
             -Direction Outbound -Action Block -RemoteAddress 192.0.2.1 | Out-Null",
        ])
        .status()
        .unwrap();
    assert!(made.success());
    let found = legacy::present();
    legacy::clean_up();
    let after = legacy::present();
    assert!(found.dns, "the group is detected");
    assert!(!found.kill_switch);
    assert!(!after.dns, "and removed");
}

/// Only processes whose image is exactly ours are stopped.
#[test]
#[ignore = "starts and stops processes"]
fn only_our_sidecar_image_is_stopped() {
    let base = std::env::temp_dir().join(format!("cvpn-reap-{}", std::process::id()));
    let ours_dir = base.join("ours");
    let other_dir = base.join("other");
    std::fs::create_dir_all(&ours_dir).unwrap();
    std::fs::create_dir_all(&other_dir).unwrap();
    // PING.EXE renamed: a harmless long-running stand-in for the sidecar.
    let ping = std::path::Path::new(r"C:\Windows\System32\PING.EXE");
    let ours = ours_dir.join("wireguard-go.exe");
    let other = other_dir.join("wireguard-go.exe");
    std::fs::copy(ping, &ours).unwrap();
    std::fs::copy(ping, &other).unwrap();
    let mut a = Command::new(&ours)
        .args(["-n", "60", "127.0.0.1"])
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let mut b = Command::new(&other)
        .args(["-n", "60", "127.0.0.1"])
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    std::thread::sleep(Duration::from_millis(300));

    let stopped = process::terminate_image(&ours);
    let a_gone = exits_soon(&mut a);
    let b_running = b.try_wait().unwrap().is_none();
    let _ = b.kill();
    let _ = b.wait();
    let _ = std::fs::remove_dir_all(&base);
    assert_eq!(stopped, 1);
    assert!(a_gone, "ours stopped");
    assert!(b_running, "the same file name elsewhere keeps running");
}

/// Whether `child` exits within a few seconds.
fn exits_soon(child: &mut std::process::Child) -> bool {
    for _ in 0..50 {
        if child.try_wait().unwrap().is_some() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// A process that dies with routes up leaves them, and their record; the next
/// start's recovery deletes exactly those routes and clears the record.
#[test]
#[ignore = "changes the routing table; needs an elevated prompt"]
fn routes_left_by_a_crash_are_removed_at_the_next_start() {
    let gw = net::default_route_v4().unwrap().expect("a default route");
    let left = (v4("192.0.2.79"), 32);
    net::add_route(left, gw.luid, Some(gw.next_hop), net::Scope::Physical).expect("add");
    let record = std::fs::read_to_string(net::record_file()).expect("record written");
    assert!(record.contains("192.0.2.79/32"), "{record}");

    net::forget_in_memory();
    assert!(
        net::route_present(left, gw.luid),
        "the crash leaves the route"
    );

    net::recover_stale();
    let gone = !net::route_present(left, gw.luid);
    let record_gone = !net::record_file().exists();
    if !gone {
        let _ = Command::new("netsh")
            .args([
                "interface",
                "ipv4",
                "delete",
                "route",
                "192.0.2.79/32",
                &net::alias_of(gw.luid),
                &gw.next_hop.to_string(),
            ])
            .status();
    }
    assert!(gone, "recovery removes the recorded route");
    assert!(record_gone, "and clears the record");
}

/// Routes on a tunnel adapter go with the adapter: they stay out of the
/// on-disk record, and are still removed in-session.
#[test]
#[ignore = "changes the routing table; needs an elevated prompt"]
fn tunnel_scoped_routes_stay_out_of_the_record() {
    let gw = net::default_route_v4().unwrap().expect("a default route");
    let pinned = (v4("192.0.2.80"), 32);
    net::add_route(pinned, gw.luid, Some(gw.next_hop), net::Scope::Tunnel).expect("add");
    let recorded = std::fs::read_to_string(net::record_file()).unwrap_or_default();
    let present = net::route_present(pinned, gw.luid);
    net::remove_routes(pinned);
    assert!(present);
    assert!(!recorded.contains("192.0.2.80/32"), "{recorded}");
    assert!(!net::route_present(pinned, gw.luid), "removed in-session");
}
