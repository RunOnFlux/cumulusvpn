//! wireguard-go sidecar lifecycle + UAPI configuration.
//!
//! On desktop we ship the userspace `wireguard-go` binary as a Tauri sidecar
//! (`binaries/wireguard-go-<target-triple>`). It creates a TUN device
//! (`wintun` on Windows, `utun` on macOS, `/dev/net/tun` on Linux) and exposes
//! the WireGuard **UAPI** control socket — a Unix domain socket at
//! `/var/run/wireguard/<iface>.sock` on Unix, or a named pipe on Windows.
//!
//! We drive it entirely over UAPI: after spawn we open the socket and write a
//! `set=1` block translated from the `.conf` produced by `@cumulusvpn/core`'s
//! `buildWgConfig` (the byte-level contract in `docs/10-api-contract.md`), then
//! poll `get=1` for the transfer counters and last-handshake surfaced in the UI.
//!
//! **What is real here:** binary resolution, process spawn, waiting for the TUN
//! device + UAPI socket, the UnixStream UAPI client (set/get), address + MTU +
//! route programming (via [`super::routing`]), and process reaping. **What
//! remains a marked seam:** the Windows named-pipe UAPI client, and elevation —
//! creating a TUN device and editing the routing table require root/Admin, so
//! in a shipped build the spawn + route calls run through the platform
//! privileged helper (macOS `SMAppService`, Linux `polkit`, Windows service).
//! Run unelevated, `spawn` fails cleanly ("needs elevated privileges").

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use super::{routing, TunnelError};

/// A parsed WireGuard configuration, ready to be rendered as a UAPI `set` block.
///
/// Field names mirror the `[Interface]` / `[Peer]` sections of the `.conf` the
/// core library emits. Keys on the wire are standard base64; UAPI wants
/// lowercase hex, so we convert at render time.
#[derive(Debug, Clone)]
pub struct WgConfig {
    pub private_key_b64: String,
    pub address: String,
    /// Interface MTU from the `.conf` (`1420` single-hop, `1340` multi-hop
    /// inner). Applied to the TUN device when we bring it up. `None` → 1420.
    pub mtu: Option<u16>,
    /// Resolver to install (applied by the privileged helper, not UAPI). `None`
    /// for a multi-hop *outer* interface, which carries no DNS — only the inner
    /// (exit) interface sets DNS. Single-hop always has it.
    pub dns: Option<String>,
    pub peer_public_key_b64: String,
    pub endpoint: String,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: u16,
}

impl WgConfig {
    /// Parse the canonical `.conf` text produced by `buildWgConfig`.
    ///
    /// This accepts exactly the shape the contract defines — one `[Interface]`
    /// and one `[Peer]` — and is intentionally strict so a malformed config is
    /// rejected before we ever spawn a tunnel.
    pub fn parse(conf: &str) -> Result<Self, TunnelError> {
        let mut private_key_b64 = None;
        let mut address = None;
        let mut mtu = None;
        let mut dns = None;
        let mut peer_public_key_b64 = None;
        let mut endpoint = None;
        let mut allowed_ips: Vec<String> = Vec::new();
        let mut persistent_keepalive: u16 = 25;

        for raw in conf.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('[') || line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            let value = value.trim().to_string();
            match key {
                "PrivateKey" => private_key_b64 = Some(value),
                "Address" => address = Some(value.trim_end_matches("/32").to_string()),
                "MTU" => mtu = value.parse().ok(),
                "DNS" => dns = Some(value),
                "PublicKey" => peer_public_key_b64 = Some(value),
                "Endpoint" => endpoint = Some(value),
                "AllowedIPs" => {
                    allowed_ips = value
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
                "PersistentKeepalive" => {
                    persistent_keepalive = value.parse().unwrap_or(25);
                }
                _ => {}
            }
        }

        Ok(WgConfig {
            private_key_b64: private_key_b64.ok_or(TunnelError::BadConfig("missing PrivateKey"))?,
            address: address.ok_or(TunnelError::BadConfig("missing Address"))?,
            mtu,
            // DNS is optional: a multi-hop outer `.conf` legitimately omits it.
            dns,
            peer_public_key_b64: peer_public_key_b64
                .ok_or(TunnelError::BadConfig("missing PublicKey"))?,
            endpoint: endpoint.ok_or(TunnelError::BadConfig("missing Endpoint"))?,
            allowed_ips: if allowed_ips.is_empty() {
                vec!["0.0.0.0/0".into(), "::/0".into()]
            } else {
                allowed_ips
            },
            persistent_keepalive,
        })
    }

    /// Render the UAPI `set=1` request that configures the interface + peer.
    ///
    /// UAPI encodes keys as lowercase hex (not base64), so we decode the
    /// standard-base64 wire keys and re-encode. Reference:
    /// <https://www.wireguard.com/xplatform/#configuration-protocol>.
    pub fn to_uapi_set(&self) -> Result<String, TunnelError> {
        let priv_hex = b64_to_hex(&self.private_key_b64)?;
        let peer_hex = b64_to_hex(&self.peer_public_key_b64)?;

        let mut out = String::new();
        out.push_str("set=1\n");
        out.push_str(&format!("private_key={priv_hex}\n"));
        out.push_str("replace_peers=true\n");
        out.push_str(&format!("public_key={peer_hex}\n"));
        out.push_str(&format!("endpoint={}\n", self.endpoint));
        out.push_str(&format!(
            "persistent_keepalive_interval={}\n",
            self.persistent_keepalive
        ));
        out.push_str("replace_allowed_ips=true\n");
        for cidr in &self.allowed_ips {
            out.push_str(&format!("allowed_ip={cidr}\n"));
        }
        out.push('\n'); // blank line terminates the UAPI request
        Ok(out)
    }
}

/// Decode standard-base64 (32-byte WG key) to the lowercase hex UAPI expects.
fn b64_to_hex(b64: &str) -> Result<String, TunnelError> {
    let bytes = B64
        .decode(b64.as_bytes())
        .map_err(|_| TunnelError::BadConfig("key is not valid base64"))?;
    if bytes.len() != 32 {
        return Err(TunnelError::BadConfig("key is not 32 bytes"));
    }
    let mut s = String::with_capacity(64);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    Ok(s)
}

/// Transfer counters + last handshake parsed from a UAPI `get=1` response.
#[derive(Debug, Default, Clone, Copy)]
pub struct WgStats {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    /// Unix seconds of the latest handshake, or `None` if none yet.
    pub last_handshake: Option<i64>,
}

/// Parse the `key=value` UAPI `get=1` response into transfer stats.
pub fn parse_uapi_get(response: &str) -> WgStats {
    let mut stats = WgStats::default();
    for line in response.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key {
            "rx_bytes" => stats.rx_bytes = value.parse().unwrap_or(0),
            "tx_bytes" => stats.tx_bytes = value.parse().unwrap_or(0),
            "last_handshake_time_sec" => {
                let secs: i64 = value.parse().unwrap_or(0);
                stats.last_handshake = if secs > 0 { Some(secs) } else { None };
            }
            _ => {}
        }
    }
    stats
}

/// Rust host target triple, used only to locate the vendored dev sidecar under
/// `CARGO_MANIFEST_DIR/binaries/` (see [`resolve_wireguard_go`]). A shipped
/// build finds the binary next to the app executable and never uses this.
#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
const HOST_TRIPLE: &str = "aarch64-apple-darwin";
#[cfg(all(target_arch = "x86_64", target_os = "macos"))]
const HOST_TRIPLE: &str = "x86_64-apple-darwin";
#[cfg(all(target_arch = "x86_64", target_os = "linux"))]
const HOST_TRIPLE: &str = "x86_64-unknown-linux-gnu";
#[cfg(all(target_arch = "aarch64", target_os = "linux"))]
const HOST_TRIPLE: &str = "aarch64-unknown-linux-gnu";
#[cfg(all(target_arch = "x86_64", target_os = "windows"))]
const HOST_TRIPLE: &str = "x86_64-pc-windows-msvc";
#[cfg(not(any(
    all(target_arch = "aarch64", target_os = "macos"),
    all(target_arch = "x86_64", target_os = "macos"),
    all(target_arch = "x86_64", target_os = "linux"),
    all(target_arch = "aarch64", target_os = "linux"),
    all(target_arch = "x86_64", target_os = "windows"),
)))]
const HOST_TRIPLE: &str = "";

/// Locate the `wireguard-go` binary at runtime.
///
/// 1. `CVPN_WIREGUARD_GO` env override (dev / tests / custom installs).
/// 2. Next to the app executable — where Tauri copies the sidecar (stripping
///    the target-triple suffix) in a packaged build.
/// 3. The vendored, triple-suffixed binary under the crate's `binaries/` dir,
///    so `cargo run` / `tauri dev` work after `scripts/fetch-wireguard-go.sh`.
fn resolve_wireguard_go() -> Result<PathBuf, TunnelError> {
    let exe_name = if cfg!(windows) {
        "wireguard-go.exe"
    } else {
        "wireguard-go"
    };

    if let Ok(p) = std::env::var("CVPN_WIREGUARD_GO") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Ok(path);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let cand = dir.join(exe_name);
            if cand.is_file() {
                return Ok(cand);
            }
        }
    }

    if !HOST_TRIPLE.is_empty() {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("wireguard-go-{HOST_TRIPLE}{suffix}"));
        if dev.is_file() {
            return Ok(dev);
        }
    }

    Err(TunnelError::Sidecar("wireguard-go binary not found"))
}

/// Path of the wireguard-go UAPI control endpoint for a device name.
fn uapi_socket_path(iface: &str) -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from(format!("/var/run/wireguard/{iface}.sock"))
    }
    #[cfg(windows)]
    {
        PathBuf::from(format!(
            r"\\.\pipe\ProtectedPrefix\Administrators\WireGuard\{iface}"
        ))
    }
}

/// The interface name we ask wireguard-go to create.
///
/// On macOS the kernel only allows `utunN` names, so we request the `utun`
/// prefix and let it auto-assign, recovering the real name from
/// `WG_TUN_NAME_FILE`. Linux/Windows accept our logical name verbatim.
#[cfg(target_os = "macos")]
fn requested_name(_logical: &str) -> String {
    "utun".to_string()
}
#[cfg(not(target_os = "macos"))]
fn requested_name(logical: &str) -> String {
    logical.to_string()
}

/// A handle to the spawned wireguard-go process + its UAPI control socket.
pub struct Sidecar {
    /// The **real** device name the kernel assigned (e.g. `utun6`, `cvpn0`).
    /// Routes and the address are programmed against this, not the logical name.
    pub interface: String,
    uapi_path: PathBuf,
    /// The child process; reaped on `kill()` or drop.
    child: Option<Child>,
}

impl Sidecar {
    /// Spawn the bundled `wireguard-go` sidecar for a logical interface name.
    ///
    /// Resolves the binary, launches it in the foreground with a name-file so we
    /// can recover the kernel-assigned device name, then waits for both the TUN
    /// device and the UAPI socket to appear. Returns a live handle, or a clear
    /// error if the binary is missing or the process exits during startup
    /// (typically: not running elevated, so it cannot create the TUN device).
    #[cfg(unix)]
    pub fn spawn(logical: &str) -> Result<Self, TunnelError> {
        let bin = resolve_wireguard_go()?;
        let requested = requested_name(logical);
        let name_file = std::env::temp_dir().join(format!("cvpn-{logical}.name"));
        let _ = fs::remove_file(&name_file);

        let mut child = Command::new(&bin)
            .arg("-f") // foreground: we own the process lifetime
            .arg(&requested)
            .env("WG_PROCESS_FOREGROUND", "1")
            .env("WG_TUN_NAME_FILE", &name_file)
            .env("LOG_LEVEL", "error")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| TunnelError::Sidecar("failed to spawn wireguard-go"))?;

        let deadline = Instant::now() + Duration::from_secs(5);

        // Phase 1: wait for the device to exist (name-file written by wg-go).
        let real = loop {
            if let Ok(Some(_status)) = child.try_wait() {
                return Err(TunnelError::Sidecar(
                    "wireguard-go exited during startup (needs elevated privileges to create the TUN device)",
                ));
            }
            if let Ok(name) = fs::read_to_string(&name_file) {
                let name = name.trim().to_string();
                if !name.is_empty() {
                    break name;
                }
            }
            // Linux may not write the name-file; fall back to the requested name
            // once its socket shows up.
            #[cfg(not(target_os = "macos"))]
            if uapi_socket_path(&requested).exists() {
                break requested.clone();
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(TunnelError::Sidecar(
                    "timed out waiting for wireguard-go to create its interface",
                ));
            }
            thread::sleep(Duration::from_millis(100));
        };

        // Phase 2: wait for the UAPI control socket.
        let uapi_path = uapi_socket_path(&real);
        while !uapi_path.exists() {
            if let Ok(Some(_status)) = child.try_wait() {
                return Err(TunnelError::Sidecar("wireguard-go exited before its UAPI socket appeared"));
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(TunnelError::Sidecar(
                    "wireguard-go started but its UAPI socket never appeared",
                ));
            }
            thread::sleep(Duration::from_millis(50));
        }

        Ok(Sidecar {
            interface: real,
            uapi_path,
            child: Some(child),
        })
    }

    /// Windows spawn seam: the process launch is real, but the wintun device +
    /// named-pipe UAPI client + WFP kill switch need the wireguard-nt helper.
    #[cfg(windows)]
    pub fn spawn(logical: &str) -> Result<Self, TunnelError> {
        let bin = resolve_wireguard_go()?;
        // POC: real impl requests elevation via the installed Windows service and
        // waits on the named pipe below instead of returning immediately.
        let child = Command::new(&bin)
            .arg("-f")
            .arg(logical)
            .env("WG_PROCESS_FOREGROUND", "1")
            .stdin(Stdio::null())
            .spawn()
            .map_err(|_| TunnelError::Sidecar("failed to spawn wireguard-go"))?;
        Ok(Sidecar {
            interface: logical.to_string(),
            uapi_path: uapi_socket_path(logical),
            child: Some(child),
        })
    }

    /// Write a UAPI request block to the control socket and read the reply.
    ///
    /// Opens a fresh connection per exchange (matching `wg-quick`'s one-shot
    /// usage), writes `request`, and reads until the terminating blank line.
    #[cfg(unix)]
    fn uapi_exchange(&self, request: &str) -> Result<String, TunnelError> {
        use std::io::{Read, Write};
        use std::os::unix::net::UnixStream;

        let mut stream = UnixStream::connect(&self.uapi_path)
            .map_err(|_| TunnelError::Uapi("cannot connect to wireguard-go UAPI socket"))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .map_err(|_| TunnelError::Uapi("cannot set socket timeout"))?;
        stream
            .write_all(request.as_bytes())
            .map_err(|_| TunnelError::Uapi("failed to write UAPI request"))?;
        stream
            .flush()
            .map_err(|_| TunnelError::Uapi("failed to flush UAPI request"))?;

        let mut buf: Vec<u8> = Vec::with_capacity(1024);
        let mut chunk = [0u8; 1024];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break, // peer closed
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    // UAPI responses terminate with an empty line.
                    if buf.ends_with(b"\n\n") {
                        break;
                    }
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    break
                }
                Err(_) => return Err(TunnelError::Uapi("failed to read UAPI response")),
            }
        }
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    /// Windows UAPI seam: talking to wireguard-go over its named pipe needs a
    /// pipe client (overlapped IO); not yet implemented.
    #[cfg(windows)]
    fn uapi_exchange(&self, _request: &str) -> Result<String, TunnelError> {
        // POC: implement the `\\.\pipe\...\WireGuard\<iface>` named-pipe client.
        Err(TunnelError::Uapi(
            "windows named-pipe UAPI client not implemented",
        ))
    }

    /// Apply a parsed config to the running interface via UAPI `set`, then bring
    /// the TUN device up with its address + MTU. wireguard-go configures crypto
    /// only — the interface address, MTU, and routes are the host's job.
    pub fn configure(&self, config: &WgConfig) -> Result<(), TunnelError> {
        let request = config.to_uapi_set()?;
        let reply = self.uapi_exchange(&request)?;
        if !reply.contains("errno=0") {
            return Err(TunnelError::Uapi("set rejected by wireguard-go"));
        }
        // Assign the tunnel address + MTU and bring the link up. The catch-all /
        // host routes are installed by the caller (`TunnelManager`) so single-
        // and multi-hop can share this step.
        routing::configure_interface(&self.interface, &config.address, config.mtu.unwrap_or(1420))?;
        // Install the resolver for the exit/single interface. The multi-hop
        // *outer* `.conf` carries no DNS (`config.dns == None`) and is skipped.
        if let Some(dns) = &config.dns {
            routing::set_dns(&self.interface, dns)?;
        }
        Ok(())
    }

    /// Poll live transfer counters + last handshake via UAPI `get`.
    pub fn stats(&self) -> Result<WgStats, TunnelError> {
        let reply = self.uapi_exchange("get=1\n\n")?;
        Ok(parse_uapi_get(&reply))
    }

    /// Kill the sidecar and remove its interface. wireguard-go tears the TUN
    /// device down on exit; the routes it required are cleaned by the caller.
    pub fn kill(mut self) -> Result<(), TunnelError> {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
