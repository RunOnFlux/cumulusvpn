//! Live ping while connected — the desktop counterpart of mobile's through-
//! the-tunnel latency stat (`clients/mobile/src/state/useVpn.ts`).
//!
//! It times a TCP handshake (one round trip: SYN → SYN-ACK) to well-known
//! anycast resolvers on 443. With the tunnel up that path goes through the VPN,
//! so the figure is the user's effective latency. The gateway's own control
//! API can't be used: it hairpins at the gateway once connected. Runs in Rust
//! because the webview's CSP / CORS would block an arbitrary probe there.

use std::net::{SocketAddr, TcpStream};
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
