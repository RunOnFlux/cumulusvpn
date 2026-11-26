//! Live ping while connected — the desktop counterpart of mobile's through-
//! the-tunnel latency stat (`clients/mobile/src/state/useVpn.ts`).
//!
//! It times a TCP handshake (one round trip: SYN → SYN-ACK) to well-known
//! anycast resolvers on 443. With the tunnel up that path goes through the VPN,
//! so the figure is the user's effective latency. The gateway's own control
//! API can't be used: it hairpins at the gateway once connected. Runs in Rust
//! because the webview's CSP / CORS would block an arbitrary probe there.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

const TARGETS: [&str; 2] = ["1.1.1.1:443", "8.8.8.8:443"];
const TIMEOUT: Duration = Duration::from_secs(3);

fn sample(addr: &SocketAddr) -> Option<u32> {
    let started = Instant::now();
    let stream = TcpStream::connect_timeout(addr, TIMEOUT).ok()?;
    let ms = started.elapsed().as_millis();
    drop(stream);
    u32::try_from(ms).ok()
}

/// Lowest of a couple of handshakes, in ms; `None` if nothing answered.
#[tauri::command]
pub async fn probe_latency() -> Option<u32> {
    tauri::async_runtime::spawn_blocking(|| {
        TARGETS
            .iter()
            .filter_map(|t| t.parse::<SocketAddr>().ok())
            .flat_map(|a| [sample(&a), sample(&a)])
            .flatten()
            .min()
    })
    .await
    .ok()
    .flatten()
}

/// Port of the gateway control API (`http://<ip>:51821`), which answers TCP.
const GATEWAY_CONTROL_PORT: u16 = 51821;
const GATEWAY_TIMEOUT: Duration = Duration::from_millis(2500);

fn gateway_sample(addr: &SocketAddr) -> Option<u32> {
    let started = Instant::now();
    let stream = TcpStream::connect_timeout(addr, GATEWAY_TIMEOUT).ok()?;
    let ms = started.elapsed().as_millis();
    drop(stream);
    u32::try_from(ms).ok()
}

/// Round trip to each gateway, measured the same way as [`probe_latency`]: the
/// lowest of two TCP handshakes to its control port, so the figure on the
/// location card and the live ping once connected agree. (Timing a whole
/// `/v1/info` fetch, as discovery used to, counted the handshake, the request
/// and the signed reply, and took the slower of two samples — several times
/// the real RTT.) Unreachable or malformed IPs are left out.
#[tauri::command]
pub async fn probe_gateways(ips: Vec<String>) -> HashMap<String, u32> {
    tauri::async_runtime::spawn_blocking(move || {
        let handles: Vec<_> = ips
            .into_iter()
            .take(256)
            .filter_map(|ip| {
                let addr = SocketAddr::new(ip.parse::<IpAddr>().ok()?, GATEWAY_CONTROL_PORT);
                Some(std::thread::spawn(move || {
                    let best = [gateway_sample(&addr), gateway_sample(&addr)]
                        .into_iter()
                        .flatten()
                        .min();
                    best.map(|ms| (ip, ms))
                }))
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok().flatten())
            .collect()
    })
    .await
    .unwrap_or_default()
}
