//! wireguard-go sidecar lifecycle + UAPI configuration.
//!
//! On desktop we ship the userspace `wireguard-go` binary as a Tauri sidecar
//! (`binaries/wireguard-go-<target-triple>`). It creates a TUN device
//! (`wintun` on Windows, `utun` on macOS, `/dev/net/tun` on Linux) and exposes
//! the WireGuard **UAPI** control socket — a Unix domain socket at
//! `/var/run/amneziawg/<iface>.sock` on Unix, or a named pipe on Windows (see
//! `uapi_socket_path`).
//!
//! We drive it entirely over UAPI: after spawn we open the socket and write a
//! `set=1` block translated from the `.conf` produced by `@cumulusvpn/core`'s
//! `buildWgConfig` (the byte-level contract in `docs/10-api-contract.md`), then
//! poll `get=1` for the transfer counters and last-handshake surfaced in the UI.
//!
//! **What is real here:** binary resolution, process spawn, waiting for the TUN
//! device + UAPI endpoint, the UAPI client (UnixStream on Unix, named pipe on
//! Windows — set/get), address + MTU + route programming (via
//! [`super::routing`]), and process reaping. **Elevation:** creating a TUN
//! device and editing the routing table require root/Admin, so this crate runs
//! inside the privileged `cumulusvpn-helper` daemon (a LaunchDaemon on macOS, a
//! systemd service on Linux, a LocalSystem service on Windows), or on macOS and
//! Linux in an app that is itself root. Run unprivileged, `spawn` fails
//! ("needs elevated privileges"); Windows refuses any host but LocalSystem up
//! front with the reason (`super::ensure_privileged`). The sidecar is found next to
//! the running executable, which for the daemon is the helper: the installers
//! put it beside `wireguard-go` (`/usr/bin`, the Windows install directory).
//!
//! **Windows specifics:** wireguard-go's Windows `main` takes exactly one
//! argument (the interface name), is always foreground (no `-f`), never writes
//! `WG_TUN_NAME_FILE` (the wintun adapter gets exactly the requested name), and
//! needs `wintun.dll` next to the executable — its Go wintun loader searches
//! only the application dir + System32, and the bundle places the DLL there via
//! `tauri.windows.conf.json`.

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
    /// Resolver(s) to make the system's (applied by `TunnelManager` through
    /// `super::dns` once routes are up, not over UAPI). `None` for a multi-hop
    /// *outer* interface, which carries no DNS — only the inner (exit)
    /// interface sets DNS. Single-hop always has it.
    pub dns: Option<String>,
    pub peer_public_key_b64: String,
    pub endpoint: String,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: u16,
    /// AmneziaWG obfuscation params from an `awg` transport's `[Interface]`
    /// (lowercased key → value, in `.conf` order: jc/jmin/…/h4). Empty for the
    /// vanilla and wg-tls transports. Emitted as device-level UAPI before the
    /// peer; requires the amneziawg-go sidecar to be accepted.
    pub obfs: Vec<(String, String)>,
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
        let mut obfs: Vec<(String, String)> = Vec::new();

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
                "Jc" | "Jmin" | "Jmax" | "S1" | "S2" | "H1" | "H2" | "H3" | "H4" => {
                    obfs.push((key.to_lowercase(), value));
                }
                _ => {}
            }
        }

        let config = WgConfig {
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
            obfs,
        };
        config.check_shape()?;
        Ok(config)
    }

    /// Every field that reaches a command line, a rule or the UAPI must be
    /// exactly what it claims to be — the config can come from a less trusted
    /// peer than the app itself (see `super::validate`). Checked at parse time
    /// so a bad config is refused before the kill switch or a sidecar is
    /// touched, not halfway through a connect.
    fn check_shape(&self) -> Result<(), TunnelError> {
        // `ip address add <address>/32` / `netsh … static <address>`.
        self.address
            .parse::<std::net::IpAddr>()
            .map_err(|_| TunnelError::BadConfig("Address is not an IP address"))?;
        super::validate::endpoint(&self.endpoint)?;
        for cidr in &self.allowed_ips {
            super::validate::cidr(cidr)?;
        }
        // Every resolver reaches the kill switch and the DNS scripts; a line
        // that is not all addresses is refused, never half-applied.
        if let Some(dns) = &self.dns {
            super::validate::dns_servers(dns)?;
        }
        b64_to_hex(&self.private_key_b64)?;
        b64_to_hex(&self.peer_public_key_b64)?;
        // AmneziaWG parameters are integers (H1–H4 may be `min-max` ranges).
        for (_, value) in &self.obfs {
            if value.is_empty()
                || value.len() > 32
                || !value.bytes().all(|b| b.is_ascii_digit() || b == b'-')
            {
                return Err(TunnelError::BadConfig("invalid obfuscation parameter"));
            }
        }
        Ok(())
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
        // Device-level AmneziaWG obfuscation params (if any) go BEFORE the peer.
        for (k, v) in &self.obfs {
            out.push_str(&format!("{k}={v}\n"));
        }
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
    /// The UDP port the sidecar is actually bound to. Needed to rebind it:
    /// the config usually asks for an ephemeral port, so the only way to learn
    /// which one wireguard-go got is to read it back.
    pub listen_port: Option<u16>,
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
            "listen_port" => stats.listen_port = value.parse().ok().filter(|p| *p != 0),
            _ => {}
        }
    }
    stats
}

/// Rust host target triple, used only to locate the vendored dev sidecar under
/// `src-tauri/binaries/` (see [`resolve_wireguard_go`]). A shipped
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
/// 3. The vendored, triple-suffixed binary under `src-tauri/binaries/` (the
///    sibling of this crate's directory, where `scripts/fetch-wireguard-go.sh`
///    puts it), so `cargo run` / `tauri dev` work without a bundle.
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
        // This crate lives at src-tauri/tunnel; the sidecars are vendored for
        // the Tauri bundler at src-tauri/binaries.
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("binaries")
            .join(format!("wireguard-go-{HOST_TRIPLE}{suffix}"));
        if dev.is_file() {
            return Ok(dev);
        }
    }

    Err(TunnelError::Sidecar("wireguard-go binary not found"))
}

/// Path of the sidecar's UAPI control endpoint for a device name.
///
/// The sidecar is amneziawg-go (`scripts/fetch-wireguard-go.sh`), which serves
/// UAPI under its own directory: `ipc/uapi_unix.go`
/// (`socketDirectory = "/var/run/amneziawg"`) and `ipc/uapi_windows.go`
/// (`ProtectedPrefix\Administrators\AmneziaWG\`). Keep in lockstep with the
/// pinned `AWG_VERSION`; `the_uapi_path_is_the_sidecars` pins both.
fn uapi_socket_path(iface: &str) -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from(format!("/var/run/amneziawg/{iface}.sock"))
    }
    #[cfg(windows)]
    {
        PathBuf::from(format!(
            r"\\.\pipe\ProtectedPrefix\Administrators\AmneziaWG\{iface}"
        ))
    }
}

/// Kill `wireguard-go` processes left behind by a host that died without
/// reaping them, so the next connect can create its device again.
///
/// An orphan is not harmless: it keeps `cvpn0` (and its UAPI endpoint) alive,
/// so the next spawn of the same interface fails, and the tunnel looks half-up
/// to anything that inspects the interface list. Windows never kills a dead
/// parent's children, and on Linux the elevated in-process app can be killed
/// without its sidecar (the systemd service is covered by its cgroup, but runs
/// this anyway at startup). Called once at startup, before any session exists
/// (`TunnelManager::recover_stale`).
///
/// Only ours: the process must be the binary [`resolve_wireguard_go`] would
/// spawn, and on Linux also have been started for one of
/// `logical_interfaces` (`wireguard-go -f cvpn0`). A no-op on macOS, where
/// launchd reaps the helper's process group and the names are kernel-assigned
/// `utunN`.
pub fn reap_orphans(logical_interfaces: &[&str]) {
    #[cfg(target_os = "linux")]
    reap_orphans_linux(logical_interfaces);
    #[cfg(windows)]
    {
        let _ = logical_interfaces;
        reap_orphans_windows();
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    let _ = logical_interfaces;
}

/// Whether a process command line (`argv`, already split) is a wireguard-go
/// sidecar we spawned for one of `names`: exactly `<…/wireguard-go> -f <name>`,
/// as [`Sidecar::spawn`] launches it on Linux. Pure, so tested on any host.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn is_our_sidecar_argv(argv: &[&str], names: &[&str]) -> bool {
    match argv {
        [bin, "-f", name] => {
            let base = bin.rsplit('/').next().unwrap_or(bin);
            base == "wireguard-go" && names.contains(name)
        }
        _ => false,
    }
}

/// `/proc/<pid>/exe` names a binary replaced since the process started (a
/// package upgrade) as `<path> (deleted)`. Still the same path for our purpose:
/// only root can have put a file there.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn strip_deleted_suffix(path: &str) -> &str {
    path.strip_suffix(" (deleted)").unwrap_or(path)
}

#[cfg(target_os = "linux")]
fn reap_orphans_linux(names: &[&str]) {
    let Some(ours) = resolve_wireguard_go()
        .ok()
        .and_then(|p| fs::canonicalize(p).ok())
    else {
        // Nothing we could have spawned, so nothing of ours to reap.
        return;
    };
    let Ok(entries) = fs::read_dir("/proc") else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name
            .to_str()
            .filter(|s| s.bytes().all(|b| b.is_ascii_digit()))
        else {
            continue;
        };
        let Ok(cmdline) = fs::read(entry.path().join("cmdline")) else {
            continue;
        };
        let text = String::from_utf8_lossy(&cmdline);
        let argv: Vec<&str> = text.split('\0').filter(|a| !a.is_empty()).collect();
        if !is_our_sidecar_argv(&argv, names) {
            continue;
        }
        let Ok(exe) = fs::read_link(entry.path().join("exe")) else {
            continue;
        };
        if std::path::Path::new(strip_deleted_suffix(&exe.to_string_lossy())) != ours {
            continue;
        }
        eprintln!(
            "cumulusvpn: reaping orphaned wireguard-go (pid {pid}, {})",
            argv[2]
        );
        let _ = Command::new("kill").args(["-KILL", pid]).output();
    }
    // A SIGKILLed wireguard-go cannot remove its UAPI socket. The next spawn
    // would see the stale file and race it, so drop the ones for our names.
    for name in names {
        let _ = fs::remove_file(uapi_socket_path(name));
    }
}

/// `ERROR_PIPE_BUSY`: every instance of the pipe is connected.
#[cfg(windows)]
const ERROR_PIPE_BUSY: i32 = 231;

/// How long a UAPI open may wait for a free pipe instance.
#[cfg(windows)]
const UAPI_BUSY_WAIT: Duration = Duration::from_secs(2);

/// Open the sidecar's UAPI pipe as a client. The server creates its next
/// instance only after accepting the previous connection (our own readiness
/// probe in [`Sidecar::spawn`], or the last exchange), so an open can briefly
/// find every instance busy. As the sidecar's own dialer does
/// (`ipc/namedpipe/namedpipe.go`, `tryDialPipe`), retry every 10 ms on
/// `ERROR_PIPE_BUSY` until a deadline; any other error is returned at once.
#[cfg(windows)]
fn open_uapi_pipe(path: &std::path::Path) -> std::io::Result<fs::File> {
    let deadline = Instant::now() + UAPI_BUSY_WAIT;
    let mut waited = false;
    loop {
        match fs::OpenOptions::new().read(true).write(true).open(path) {
            Ok(pipe) => {
                if waited {
                    eprintln!(
                        "cumulusvpn-tunnel: UAPI pipe was busy; opened after {:?}",
                        UAPI_BUSY_WAIT
                            .saturating_sub(deadline.saturating_duration_since(Instant::now()))
                    );
                }
                return Ok(pipe);
            }
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && Instant::now() < deadline => {
                waited = true;
                thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(e),
        }
    }
}

/// Log the I/O error behind a UAPI failure; [`TunnelError`] carries the fixed message.
#[cfg(windows)]
fn uapi_failure(what: &'static str, e: std::io::Error) -> TunnelError {
    eprintln!("cumulusvpn-tunnel: {what}: {e}");
    TunnelError::Uapi(what)
}

/// Stop every `wireguard-go.exe` running from our own install, matched by its
/// image path: the copy in our install directory is run by this app alone.
#[cfg(windows)]
fn reap_orphans_windows() {
    let Ok(bin) = resolve_wireguard_go() else {
        return;
    };
    super::win::process::terminate_image(&bin);
}

/// The interface name we ask wireguard-go to create.
///
/// On macOS the kernel only allows `utunN` names, so we request the `utun`
/// prefix and let it auto-assign, recovering the real name from
/// `WG_TUN_NAME_FILE`. Linux accepts our logical name verbatim. (Windows does
/// too — wintun names the adapter exactly as requested, and the `cvpn*` labels
/// are valid adapter aliases — so its `spawn` passes the logical name directly
/// and this indirection is Unix-only.)
#[cfg(target_os = "macos")]
fn requested_name(_logical: &str) -> String {
    "utun".to_string()
}
#[cfg(all(unix, not(target_os = "macos")))]
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
                return Err(TunnelError::Sidecar(
                    "wireguard-go exited before its UAPI socket appeared",
                ));
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

    /// Windows spawn: same lifecycle as Unix minus the name-file dance — the
    /// wintun adapter gets exactly the requested name, so the two wait phases
    /// collapse into one: probe the UAPI named pipe by *opening* it, which is
    /// both the readiness check and the existence check (`Path::exists` is not
    /// dependable for `\\.\pipe\` paths). The pipe lives under
    /// `ProtectedPrefix\Administrators`, so a successful open also proves the
    /// endpoint is wireguard-go's, not a squatter's.
    #[cfg(windows)]
    pub fn spawn(logical: &str) -> Result<Self, TunnelError> {
        use std::os::windows::process::CommandExt;

        let bin = resolve_wireguard_go()?;
        // wireguard-go's own output (error level) goes to a per-device log,
        // which records why a start failed.
        let log_path = std::env::temp_dir().join(format!("cumulusvpn-wireguard-go-{logical}.log"));
        let log = fs::File::create(&log_path).map_err(|e| {
            eprintln!(
                "cumulusvpn-tunnel: cannot create {}: {e}",
                log_path.display()
            );
            TunnelError::Sidecar("cannot create the wireguard-go log file")
        })?;
        let log_err = log.try_clone().map_err(|e| {
            eprintln!(
                "cumulusvpn-tunnel: cannot share {}: {e}",
                log_path.display()
            );
            TunnelError::Sidecar("cannot create the wireguard-go log file")
        })?;
        eprintln!(
            "cumulusvpn-tunnel: starting {} {logical} (log: {})",
            bin.display(),
            log_path.display()
        );
        let mut child = Command::new(&bin)
            .arg(logical) // windows main: exactly one arg, always foreground
            .env("LOG_LEVEL", "error")
            .creation_flags(super::CREATE_NO_WINDOW) // GUI app: no console flash
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(log_err)
            .spawn()
            .map_err(|e| {
                eprintln!("cumulusvpn-tunnel: cannot spawn {}: {e}", bin.display());
                TunnelError::Sidecar("failed to spawn wireguard-go")
            })?;

        let uapi_path = uapi_socket_path(logical);
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                eprintln!(
                    "cumulusvpn-tunnel: wireguard-go exited during startup ({status}); its output: {}",
                    fs::read_to_string(&log_path)
                        .unwrap_or_default()
                        .trim()
                );
                return Err(TunnelError::Sidecar(
                    "wireguard-go exited during startup; its error is in the wireguard-go log named in the helper log",
                ));
            }
            let opened = fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&uapi_path);
            if opened.is_ok() {
                break;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                if let Err(e) = opened {
                    eprintln!(
                        "cumulusvpn-tunnel: UAPI pipe {} not openable after 5s: {e}",
                        uapi_path.display()
                    );
                }
                return Err(TunnelError::Sidecar(
                    "wireguard-go started but its UAPI pipe never appeared",
                ));
            }
            thread::sleep(Duration::from_millis(100));
        }

        Ok(Sidecar {
            interface: logical.to_string(),
            uapi_path,
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

    /// Windows UAPI client. The sidecar serves UAPI on the byte-mode named
    /// pipe `\\.\pipe\ProtectedPrefix\Administrators\AmneziaWG\<iface>`; for
    /// our strictly request→response usage a plain synchronous `File` opened
    /// read+write IS a pipe client — no overlapped IO needed. Fresh connection
    /// per exchange, like the Unix client. There is no read timeout (`File`
    /// cannot express one): the server always terminates a response with a
    /// blank line, and if it dies mid-read the pipe breaks and the read
    /// returns, so this cannot hang indefinitely.
    #[cfg(windows)]
    fn uapi_exchange(&self, request: &str) -> Result<String, TunnelError> {
        use std::io::{Read, Write};

        let mut pipe = open_uapi_pipe(&self.uapi_path)
            .map_err(|e| uapi_failure("cannot open wireguard-go UAPI pipe", e))?;
        pipe.write_all(request.as_bytes())
            .map_err(|e| uapi_failure("failed to write UAPI request", e))?;
        pipe.flush()
            .map_err(|e| uapi_failure("failed to flush UAPI request", e))?;

        let mut buf: Vec<u8> = Vec::with_capacity(1024);
        let mut chunk = [0u8; 1024];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break, // peer closed
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    // UAPI responses terminate with an empty line.
                    if buf.ends_with(b"\n\n") {
                        break;
                    }
                }
                // A broken pipe after (partial) data is the peer going away —
                // return what we have, mirroring the Unix timeout path.
                Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => break,
                Err(e) => return Err(uapi_failure("failed to read UAPI response", e)),
            }
        }
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    /// Apply a parsed config to the running interface via UAPI `set`, then bring
    /// the TUN device up with its address + MTU. wireguard-go configures crypto
    /// only — the interface address, MTU, and routes are the host's job.
    pub fn configure(&self, config: &WgConfig) -> Result<(), TunnelError> {
        self.apply(config)?;
        // Assign the tunnel address + MTU and bring the link up. The catch-all /
        // host routes are installed by the caller (`TunnelManager`) so single-
        // and multi-hop can share this step.
        routing::configure_interface(&self.interface, &config.address, config.mtu.unwrap_or(1420))?;
        // DNS is NOT set here: it is system-wide, and has to wait until the
        // routes point at the tunnel. `TunnelManager` applies it last, for the
        // single-hop device or the multi-hop exit (see `super::dns`).
        Ok(())
    }

    /// Send `config` to the device over UAPI `set`.
    fn apply(&self, config: &WgConfig) -> Result<(), TunnelError> {
        let request = config.to_uapi_set()?;
        let reply = self.uapi_exchange(&request)?;
        if !reply.contains("errno=0") {
            // The reply is `errno=<n>`; it is logged, and the request, which
            // holds the private key, stays out of the log.
            eprintln!(
                "cumulusvpn-tunnel: wireguard-go rejected the UAPI set: {}",
                reply.trim()
            );
            return Err(TunnelError::Uapi("set rejected by wireguard-go"));
        }
        Ok(())
    }

    /// Poll live transfer counters + last handshake via UAPI `get`.
    pub fn stats(&self) -> Result<WgStats, TunnelError> {
        let reply = self.uapi_exchange("get=1\n\n")?;
        Ok(parse_uapi_get(&reply))
    }

    /// Reopen the sidecar's UDP socket on whatever the default route is now.
    ///
    /// The desktop client drives a wireguard-go SIDECAR over UAPI, so there is
    /// no in-process `BindUpdate` to call as there is on mobile. Re-sending the
    /// port the device is already bound to is the equivalent: `handleDeviceLine`
    /// runs `BindUpdate()` for any `listen_port=` line, with no early return
    /// when the value is unchanged (device/uapi.go), which closes the socket and
    /// reopens it on the current interface, clearing each peer's cached source
    /// address on the way.
    ///
    /// The port has to be read back rather than assumed: our configs ask for an
    /// ephemeral port, so the number only exists inside the sidecar. A device
    /// that reports no port has not finished coming up, and rebinding it would
    /// be meaningless — hence the `Ok(false)`.
    pub fn rebind(&self) -> Result<bool, TunnelError> {
        let Some(port) = self.stats()?.listen_port else {
            return Ok(false);
        };
        let reply = self.uapi_exchange(&format!("set=1\nlisten_port={port}\n\n"))?;
        if !reply.contains("errno=0") {
            return Err(TunnelError::Uapi(
                "listen_port rebind rejected by wireguard-go",
            ));
        }
        Ok(true)
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

/// The UAPI endpoint is where the pinned amneziawg-go serves it; a mismatch
/// shows up as a sidecar that starts and a connect that times out waiting for
/// its control endpoint.
#[cfg(test)]
mod uapi_path_tests {
    use super::uapi_socket_path;
    use std::path::PathBuf;

    #[test]
    fn the_uapi_path_is_the_sidecars() {
        #[cfg(unix)]
        assert_eq!(
            uapi_socket_path("cvpn0"),
            PathBuf::from("/var/run/amneziawg/cvpn0.sock")
        );
        #[cfg(windows)]
        assert_eq!(
            uapi_socket_path("cvpn0"),
            PathBuf::from(r"\\.\pipe\ProtectedPrefix\Administrators\AmneziaWG\cvpn0")
        );
    }

    /// Only `ERROR_PIPE_BUSY` is waited out; a pipe that does not exist fails
    /// at once.
    #[cfg(windows)]
    #[test]
    fn a_missing_uapi_pipe_fails_without_waiting() {
        let started = std::time::Instant::now();
        let err = super::open_uapi_pipe(std::path::Path::new(
            r"\\.\pipe\CumulusVPN.test.no-such-uapi-pipe",
        ))
        .expect_err("no such pipe");
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound, "{err}");
        assert!(started.elapsed() < super::UAPI_BUSY_WAIT / 2);
    }
}

#[cfg(test)]
mod orphan_tests {
    use super::{is_our_sidecar_argv, strip_deleted_suffix};

    const NAMES: &[&str] = &["cvpn0", "cvpn-entry", "cvpn-exit"];

    #[test]
    fn only_our_sidecar_command_lines_are_reaped() {
        assert!(is_our_sidecar_argv(
            &["/usr/bin/wireguard-go", "-f", "cvpn0"],
            NAMES
        ));
        assert!(is_our_sidecar_argv(
            &["wireguard-go", "-f", "cvpn-exit"],
            NAMES
        ));
        // Someone else's WireGuard, another interface, or another program.
        assert!(!is_our_sidecar_argv(
            &["/usr/bin/wireguard-go", "-f", "wg0"],
            NAMES
        ));
        assert!(!is_our_sidecar_argv(
            &["/usr/bin/wireguard-go", "cvpn0"],
            NAMES
        ));
        assert!(!is_our_sidecar_argv(
            &["/usr/bin/sleep", "-f", "cvpn0"],
            NAMES
        ));
        assert!(!is_our_sidecar_argv(
            &["/usr/bin/wireguard-go", "-f", "cvpn0", "extra"],
            NAMES
        ));
        assert!(!is_our_sidecar_argv(&[], NAMES));
    }

    #[test]
    fn an_upgraded_binary_still_matches_its_path() {
        assert_eq!(
            strip_deleted_suffix("/usr/bin/wireguard-go (deleted)"),
            "/usr/bin/wireguard-go"
        );
        assert_eq!(
            strip_deleted_suffix("/usr/bin/wireguard-go"),
            "/usr/bin/wireguard-go"
        );
    }
}

#[cfg(test)]
mod obfs_tests {
    use super::{parse_uapi_get, WgConfig};

    // 32 zero bytes, standard base64 — valid input for b64_to_hex.
    const KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    #[test]
    fn obfs_params_parse_and_emit_before_peer() {
        let conf = format!(
            "[Interface]\nPrivateKey = {KEY}\nAddress = 10.8.0.2/32\nDNS = 1.1.1.1\n\
             Jc = 4\nJmin = 40\nH1 = 5\n\n[Peer]\nPublicKey = {KEY}\n\
             Endpoint = 1.2.3.4:51821\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n"
        );
        let cfg = WgConfig::parse(&conf).expect("parse");
        assert_eq!(cfg.obfs.len(), 3, "jc/jmin/h1 collected");
        let uapi = cfg.to_uapi_set().expect("uapi");
        let jc = uapi.find("jc=4").expect("jc present");
        let pk = uapi.find("public_key=").expect("public_key present");
        assert!(jc < pk, "device obfs params must precede the peer");
        assert!(uapi.contains("jmin=40") && uapi.contains("h1=5"));
    }

    #[test]
    fn vanilla_conf_carries_no_obfs() {
        let conf = format!(
            "[Interface]\nPrivateKey = {KEY}\nAddress = 10.8.0.2/32\nDNS = 1.1.1.1\n\n\
             [Peer]\nPublicKey = {KEY}\nEndpoint = 1.2.3.4:51820\n\
             AllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n"
        );
        let cfg = WgConfig::parse(&conf).expect("parse");
        assert!(cfg.obfs.is_empty());
        assert!(!cfg.to_uapi_set().unwrap().contains("jc="));
    }

    #[test]
    fn parse_uapi_get_reads_the_bound_port() {
        // rebind() has to send back the port the device actually got, and our
        // configs ask for an ephemeral one — so the only source of truth is the
        // `get=1` reply.
        let stats = parse_uapi_get("listen_port=51820\nrx_bytes=10\ntx_bytes=20\nerrno=0\n");
        assert_eq!(stats.listen_port, Some(51820));
        assert_eq!(stats.rx_bytes, 10);
        assert_eq!(stats.tx_bytes, 20);
    }

    /// Address, Endpoint and AllowedIPs reach `ip`/`netsh` argv and the UAPI;
    /// keys must be real keys. Each is refused at parse time, before a connect
    /// touches the kill switch.
    #[test]
    fn config_fields_must_be_what_they_claim_to_be() {
        let good = |field: &str, value: &str| {
            let mut conf = format!(
                "[Interface]\nPrivateKey = {KEY}\nAddress = 10.8.0.2/32\n\n[Peer]\n\
                 PublicKey = {KEY}\nEndpoint = 1.2.3.4:51820\nAllowedIPs = 0.0.0.0/0\n"
            );
            let line = conf
                .lines()
                .find(|l| l.starts_with(field))
                .expect("field")
                .to_string();
            conf = conf.replace(&line, &format!("{field} = {value}"));
            WgConfig::parse(&conf)
        };
        assert!(good("Address", "10.8.0.2/32").is_ok());
        assert!(good("Address", "10.8.0.2 dev lo").is_err());
        assert!(good("Address", "10.8.0.0/24").is_err());
        assert!(good("Endpoint", "gateway.example.com:51820").is_err());
        assert!(good("Endpoint", "1.2.3.4").is_err());
        assert!(good("AllowedIPs", "0.0.0.0/0, 10.0.0.0/40").is_err());
        assert!(good("PublicKey", "not-a-key").is_err());
        assert!(good("PrivateKey", "AAAA").is_err());
    }

    /// The `DNS =` line keeps every resolver of a Settings → DNS provider, and
    /// a line that is not all addresses is refused at parse time.
    #[test]
    fn dns_lines_list_resolvers_and_nothing_else() {
        let conf = |dns: &str| {
            format!(
                "[Interface]\nPrivateKey = {KEY}\nAddress = 10.8.0.2/32\nDNS = {dns}\n\n\
                 [Peer]\nPublicKey = {KEY}\nEndpoint = 1.2.3.4:51820\nAllowedIPs = 0.0.0.0/0\n"
            )
        };
        let cfg = WgConfig::parse(&conf("9.9.9.9, 149.112.112.112")).expect("parse");
        assert_eq!(cfg.dns.as_deref(), Some("9.9.9.9, 149.112.112.112"));
        assert!(WgConfig::parse(&conf("94.140.14.14,94.140.15.15")).is_ok());
        assert!(WgConfig::parse(&conf("1.1.1.1; reboot")).is_err());
        assert!(WgConfig::parse(&conf("9.9.9.9, 1.2.3.4 } accept")).is_err());
        assert!(WgConfig::parse(&conf("dns.quad9.net")).is_err());
    }

    #[test]
    fn obfuscation_values_are_numbers_or_ranges() {
        let conf = |jc: &str| {
            format!(
                "[Interface]\nPrivateKey = {KEY}\nAddress = 10.8.0.2/32\nJc = {jc}\nH1 = 100-200\n\n\
                 [Peer]\nPublicKey = {KEY}\nEndpoint = 1.2.3.4:51821\nAllowedIPs = 0.0.0.0/0\n"
            )
        };
        assert!(WgConfig::parse(&conf("4")).is_ok());
        assert!(WgConfig::parse(&conf("4 extra")).is_err());
        assert!(WgConfig::parse(&conf("")).is_err());
    }

    #[test]
    fn parse_uapi_get_treats_port_zero_as_absent() {
        // A device that has not finished coming up reports 0. Rebinding to port
        // 0 would move it to a DIFFERENT ephemeral port, silently changing the
        // source the gateway has learned.
        assert_eq!(parse_uapi_get("listen_port=0\nerrno=0\n").listen_port, None);
        assert_eq!(parse_uapi_get("errno=0\n").listen_port, None);
        assert_eq!(parse_uapi_get("listen_port=junk\n").listen_port, None);
    }
}
