//! Wire protocol between the CumulusVPN app and its privileged helper.
//!
//! The app runs unprivileged on every desktop OS. Everything that needs root or
//! Administrator (the firewall, the routing table, creating the tun device,
//! spawning `wireguard-go`, the system resolver) happens in the
//! `cumulusvpn-helper` daemon, and these types cross the local IPC channel
//! between them:
//!
//! * **macOS**: a LaunchDaemon on the Unix socket [`SOCKET_PATH`].
//! * **Linux**: a systemd service on the Unix socket [`SOCKET_PATH`].
//! * **Windows**: a LocalSystem service on the named pipe [`PIPE_NAME`].
//!
//! An elevated app can run `cumulusvpn-tunnel` in-process instead: on macOS
//! whenever it runs as root (an unsigned build launched with `sudo`), on Linux
//! and Windows only when no daemon answers (an AppImage, or a build whose
//! service is not installed). These same request and status types are that
//! path's interface too, so the Tauri commands have one shape however the
//! tunnel is hosted.
//!
//! This crate stays free of both Tauri and any privileged code: it is linked
//! into a process running as root, and every dependency here is attack surface
//! at that privilege level.
//!
//! **Framing.** Each message is a 4-byte big-endian length followed by that many
//! bytes of JSON. A length prefix rather than newline-delimited JSON because the
//! config blobs carry newlines; big-endian because it is the wire convention and
//! both ends are ours. [`MAX_FRAME`] caps what the daemon will allocate for a
//! single request — an unauthenticated peer must not be able to ask a root
//! process for an arbitrary amount of memory.

use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};

/// Where the macOS helper listens. Under `/var/run`, the standard location for
/// a LaunchDaemon socket, and a path only root can create.
#[cfg(target_os = "macos")]
pub const SOCKET_PATH: &str = "/var/run/cumulusvpn-helper.sock";

/// Where the Linux helper listens. `/run/cumulusvpn` is the service's
/// `RuntimeDirectory=` (root-owned, 0755, created and removed by systemd), so
/// only root can create a socket here, and the socket itself is
/// `root:`[`LINUX_GROUP`] mode 0660. Must match `linux/cumulusvpn-helper.service`
/// (a helper test checks it).
#[cfg(all(unix, not(target_os = "macos")))]
pub const SOCKET_PATH: &str = "/run/cumulusvpn/helper.sock";

/// The Windows helper's named pipe. The service creates the first instance
/// with `FILE_FLAG_FIRST_PIPE_INSTANCE` and a security descriptor that lets
/// interactive users read and write but not create instances, and the app
/// refuses a pipe that is not owned by SYSTEM or Administrators, so neither side
/// can be impersonated by an unprivileged process squatting on the name.
pub const PIPE_NAME: &str = r"\\.\pipe\CumulusVPN.Helper";

/// The access the app requests when it opens [`PIPE_NAME`]:
/// `FILE_GENERIC_READ | FILE_WRITE_DATA`. It is exactly what the pipe's
/// security descriptor grants interactive users. Deliberately not
/// `GENERIC_WRITE`, which includes `FILE_APPEND_DATA` — for a pipe that is
/// `FILE_CREATE_PIPE_INSTANCE` (0x4), the right to add *server* instances of
/// the pipe and intercept clients, and the descriptor withholds it.
pub const PIPE_CLIENT_ACCESS: u32 = 0x0012_008B;

/// The helper's LaunchDaemon label. Must match the plist filename shipped in
/// `Contents/Library/LaunchDaemons/`, which is what `SMAppService` registers.
pub const HELPER_LABEL: &str = "com.cumulusvpn.helper";

/// The Windows service name (`sc.exe query CumulusVPNHelper`). Registered by the
/// installers: `windows/hooks.nsh` (NSIS) and `windows/helper-service.wxs` (MSI).
pub const WINDOWS_SERVICE_NAME: &str = "CumulusVPNHelper";

/// The systemd unit the Linux packages install and enable.
pub const LINUX_UNIT: &str = "cumulusvpn-helper.service";

/// The group whose members may use the Linux helper. The package's postinst
/// creates it and adds the installing user; the socket is `root:cumulusvpn`
/// mode 0660, so the kernel refuses everyone else before the daemon sees them.
pub const LINUX_GROUP: &str = "cumulusvpn";

/// The app's executable name, without `.exe` (the Cargo package name; there is
/// no `mainBinaryName` override in `tauri.conf.json`). On Linux and Windows the
/// helper only serves an unprivileged peer whose executable is the installed
/// app, which sits in the same directory as the helper (`/usr/bin`, or the
/// install directory under Program Files).
pub const APP_BINARY_NAME: &str = "cumulusvpn-desktop";

/// What the helper says to a peer it refuses, before closing the connection.
/// The app matches on it to tell "refused" apart from "not running".
pub const NOT_AUTHORISED: &str = "not authorised";

/// Largest single message either side will read. Comfortably above a multi-hop
/// request (two WireGuard configs plus route lists), far below anything that
/// would strain the daemon.
pub const MAX_FRAME: u32 = 1024 * 1024;

/// Lifecycle of the tunnel, as reported to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelState {
    Down,
    Connecting,
    Up,
    Error,
}

/// Status snapshot. Mirrors the frontend's `TunnelStatus` interface
/// field-for-field (`src/lib/tauri.ts`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    pub state: TunnelState,
    pub endpoint: Option<String>,
    pub assigned_ip: Option<String>,
    pub country: Option<String>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub last_handshake: Option<i64>,
    pub error: Option<String>,
    /// Set while the tunnel is up but the system resolver could not be pointed
    /// at the tunnel's — so lookups may be leaking (kill switch off) or failing
    /// (kill switch on). The UI shows it as a warning instead of a clean
    /// "protected". `default` so an app talking to a helper built before this
    /// field existed still parses its status.
    #[serde(default)]
    pub dns_warning: Option<String>,
}

/// wg-tls transport parameters: bridge the WireGuard device over TLS instead of
/// dialing UDP directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsParams {
    /// `<gatewayIp>:<tlsPort>` — the TLS relay to bridge to (TCP).
    pub server_addr: String,
    /// SNI / cert name to present. Camouflage only (not verified).
    pub sni: String,
}

/// Compiled split-tunneling route lists (core-ts `compileSplitPolicy`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SplitParams {
    /// Prefixes that MUST egress on the physical path (exclude mode + LAN
    /// bypass).
    pub bypass_routes: Vec<String>,
    /// Prefixes routed INTO the tunnel (include mode).
    pub tunnel_routes: Vec<String>,
}

/// Single-hop connect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectRequest {
    pub country: String,
    pub wg_config: String,
    pub endpoint: String,
    pub assigned_ip: String,
    pub kill_switch: bool,
    pub tls: Option<TlsParams>,
    pub split: Option<SplitParams>,
}

/// Multi-hop connect: two stacked devices sharing one key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultihopRequest {
    pub entry_country: String,
    pub exit_country: String,
    pub outer: String,
    pub inner: String,
    pub entry_endpoint: String,
    pub exit_endpoint: String,
    pub inner_mtu: u16,
    pub assigned_ip: String,
    pub kill_switch: bool,
    pub split: Option<SplitParams>,
}

/// What the app asks the helper to do. The whole privileged surface is these
/// four operations — keeping it this small is the point: it is the entire set of
/// things a compromised app could ask a root daemon for.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Connect(Box<ConnectRequest>),
    ConnectMultihop(Box<MultihopRequest>),
    Disconnect,
    Status,
    /// Liveness probe used by the app to decide whether the helper is installed
    /// and reachable before it offers to connect.
    Ping,
}

/// The helper's reply. Errors cross the wire as strings: the app only ever
/// surfaces them, and a structured error type would couple the two crates for
/// no gain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum Response {
    Status(Box<TunnelStatus>),
    Pong { version: String },
    Error { message: String },
}

/// Write a length-prefixed JSON frame.
pub fn write_frame<W: Write>(w: &mut W, value: &impl Serialize) -> io::Result<()> {
    let body = serde_json::to_vec(value).map_err(io::Error::other)?;
    let len = u32::try_from(body.len())
        .ok()
        .filter(|n| *n <= MAX_FRAME)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "frame too large"))?;
    w.write_all(&len.to_be_bytes())?;
    w.write_all(&body)?;
    w.flush()
}

/// Read a length-prefixed JSON frame, refusing anything over [`MAX_FRAME`]
/// before allocating.
pub fn read_frame<R: Read, T: for<'de> Deserialize<'de>>(r: &mut R) -> io::Result<T> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf)?;
    let len = u32::from_be_bytes(len_buf);
    if len > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame exceeds maximum",
        ));
    }
    let mut body = vec![0u8; len as usize];
    r.read_exact(&mut body)?;
    serde_json::from_slice(&body).map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(req: &Request) -> Request {
        let mut buf = Vec::new();
        write_frame(&mut buf, req).expect("write");
        read_frame(&mut buf.as_slice()).expect("read")
    }

    #[test]
    fn requests_survive_the_wire() {
        let req = Request::Connect(Box::new(ConnectRequest {
            country: "DE".into(),
            // Configs carry newlines — the reason for length prefixing rather
            // than newline-delimited JSON.
            wg_config: "[Interface]\nPrivateKey = x\n\n[Peer]\n".into(),
            endpoint: "203.0.113.7:51820".into(),
            assigned_ip: "10.7.0.2/32".into(),
            kill_switch: true,
            tls: None,
            split: None,
        }));
        match roundtrip(&req) {
            Request::Connect(c) => {
                assert_eq!(c.country, "DE");
                assert!(c.wg_config.contains('\n'));
                assert!(c.kill_switch);
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn unit_variants_survive_the_wire() {
        assert!(matches!(
            roundtrip(&Request::Disconnect),
            Request::Disconnect
        ));
        assert!(matches!(roundtrip(&Request::Status), Request::Status));
        assert!(matches!(roundtrip(&Request::Ping), Request::Ping));
    }

    /// The daemon must decide a frame is too big from the 4-byte header alone —
    /// before allocating — or an unauthenticated peer can make a root process
    /// reserve arbitrary memory.
    #[test]
    fn an_oversized_frame_is_refused_before_allocating() {
        let mut framed = Vec::new();
        framed.extend_from_slice(&(MAX_FRAME + 1).to_be_bytes());
        // Deliberately no body: rejection must not depend on reading one.
        let err = read_frame::<_, Request>(&mut framed.as_slice()).expect_err("must refuse");
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn a_truncated_frame_is_an_error_not_a_hang() {
        let mut framed = Vec::new();
        framed.extend_from_slice(&64u32.to_be_bytes());
        framed.extend_from_slice(b"{\"op\":");
        assert!(read_frame::<_, Request>(&mut framed.as_slice()).is_err());
    }

    /// Framing over a real socket, not a `Vec`. A `Vec` always returns the
    /// whole buffer at once; a socket can split a message across reads, which is
    /// exactly what a length prefix has to survive. Two messages are sent
    /// back-to-back so a reader that over-consumed would corrupt the second.
    /// Unix sockets only here; the Windows named pipe is a byte stream with the
    /// same short-read behaviour, and is exercised on Windows itself.
    #[cfg(unix)]
    #[test]
    fn frames_survive_a_real_socket_including_short_reads() {
        use std::os::unix::net::UnixStream;
        use std::thread;

        let (mut a, mut b) = UnixStream::pair().expect("socketpair");
        let big = "x".repeat(200_000);
        let sent = Request::Connect(Box::new(ConnectRequest {
            country: "DE".into(),
            wg_config: big.clone(),
            endpoint: "203.0.113.7:51820".into(),
            assigned_ip: "10.7.0.2/32".into(),
            kill_switch: true,
            tls: None,
            split: None,
        }));
        let writer = thread::spawn(move || {
            write_frame(&mut a, &sent).expect("write large");
            write_frame(&mut a, &Request::Status).expect("write second");
        });

        match read_frame::<_, Request>(&mut b).expect("read large") {
            Request::Connect(c) => assert_eq!(c.wg_config.len(), big.len()),
            other => panic!("wrong variant: {other:?}"),
        }
        // The second message must still be intact and correctly aligned.
        assert!(matches!(
            read_frame::<_, Request>(&mut b).expect("read second"),
            Request::Status
        ));
        writer.join().expect("writer thread");
    }

    /// The app and the helper are upgraded separately. A status from a helper
    /// that predates `dnsWarning` must still parse (as "no warning"), or the
    /// app would read every poll as an unreachable helper.
    #[test]
    fn a_status_without_dns_warning_still_parses() {
        let s: TunnelStatus = serde_json::from_str(
            r#"{"state":"up","endpoint":null,"assignedIp":null,"country":null,
                "rxBytes":0,"txBytes":0,"lastHandshake":null,"error":null}"#,
        )
        .expect("old status shape");
        assert!(s.dns_warning.is_none());
    }

    #[test]
    fn status_camel_cases_for_the_frontend() {
        let json = serde_json::to_string(&TunnelStatus {
            state: TunnelState::Up,
            endpoint: None,
            assigned_ip: Some("10.7.0.2".into()),
            country: None,
            rx_bytes: 1,
            tx_bytes: 2,
            last_handshake: None,
            error: None,
            dns_warning: Some("dns".into()),
        })
        .expect("serialize");
        assert!(json.contains("\"assignedIp\""), "got {json}");
        assert!(json.contains("\"dnsWarning\":\"dns\""), "got {json}");
        assert!(json.contains("\"rxBytes\""), "got {json}");
        assert!(json.contains("\"state\":\"up\""), "got {json}");
    }
}
