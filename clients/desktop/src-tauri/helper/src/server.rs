//! The helper's request server: authenticate each peer, then serve requests.
//!
//! The request path ([`serve`], [`dispatch`]) is the same on every OS and works
//! over any byte stream. Only the transport differs: a Unix socket on macOS and
//! Linux ([`bind_socket`] / [`serve_forever`] here), a named pipe on Windows
//! (`pipe.rs`, which feeds the same [`serve`]).
//!
//! The authenticator is a parameter rather than a hard call to the platform's
//! peer check. Production passes exactly that (see `main`), and tests pass a
//! stand-in. The tests do not depend on the build profile, a real signature or
//! real group membership, and they can assert the property that matters most:
//! a refused peer never reaches [`dispatch`]. They run on the Linux CI: the
//! accept/serve loop needs no root as long as nothing asks the tunnel to
//! actually move.

use std::io::{self, Read, Write};
#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::Arc;
#[cfg(unix)]
use std::thread;

use cumulusvpn_protocol as proto;
use cumulusvpn_tunnel::TunnelManager;

/// Decides whether the process on the other end of a connection may use the
/// daemon. `Err` carries the reason, which is logged but never sent to the peer.
pub type Authenticator<S> = Arc<dyn Fn(&S) -> Result<(), String> + Send + Sync>;

/// Bind the listening socket, replacing a stale one left by an unclean exit.
///
/// The socket is created while the umask allows nobody but root (so it is never
/// reachable more widely than intended, not even for an instant), then given
/// `group` (if any) and `mode`:
///
/// * **macOS**: mode 0666, no group. Safe only because of the code-signature
///   check in `peer::authenticate`: the app runs as whichever human is logged
///   in, so file permissions cannot express "our app and nothing else", and
///   identity is proven cryptographically instead.
/// * **Linux**: `root:cumulusvpn` mode 0660. The kernel refuses `connect()` to
///   anyone outside the group before the daemon ever sees them; the peer check
///   in `peer_linux` then re-checks the credentials and the executable.
#[cfg(unix)]
pub fn bind_socket(path: &str, mode: u32, group: Option<u32>) -> io::Result<UnixListener> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    match fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    // SAFETY: `umask` only swaps the process file-creation mask. It is
    // process-wide, so it is restored immediately; every caller binds before
    // spawning the threads that create files.
    let previous = unsafe { libc::umask(0o177) };
    let bound = UnixListener::bind(path);
    // SAFETY: as above, restoring the mask we read.
    unsafe { libc::umask(previous) };
    let listener = bound?;
    if let Some(gid) = group {
        std::os::unix::fs::chown(path, Some(0), Some(gid))?;
    }
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(listener)
}

/// Accept connections until the listener dies.
#[cfg(unix)]
pub fn serve_forever(
    listener: UnixListener,
    manager: Arc<TunnelManager>,
    auth: Authenticator<UnixStream>,
) {
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let manager = Arc::clone(&manager);
                let auth = Arc::clone(&auth);
                // One thread per connection: the app holds at most one, and a
                // slow client must never stall the repair loop.
                thread::spawn(move || {
                    if let Err(e) = serve(s, &manager, &*auth) {
                        log_connection_end(&e);
                    }
                });
            }
            Err(e) => eprintln!("cumulusvpn-helper: accept failed: {e}"),
        }
    }
}

/// Log a connection that ended in an error. A client hanging up mid-request is
/// routine, not news.
pub fn log_connection_end(e: &io::Error) {
    if e.kind() != io::ErrorKind::UnexpectedEof {
        eprintln!("cumulusvpn-helper: connection ended: {e}");
    }
}

/// Authenticate the peer once, then serve requests until it hangs up.
pub fn serve<S: Read + Write>(
    mut stream: S,
    manager: &TunnelManager,
    auth: &(dyn Fn(&S) -> Result<(), String> + Send + Sync),
) -> io::Result<()> {
    // Before anything else. An unauthenticated peer never reaches `dispatch`.
    if let Err(reason) = auth(&stream) {
        eprintln!("cumulusvpn-helper: rejected peer: {reason}");
        let _ = proto::write_frame(
            &mut stream,
            &proto::Response::Error {
                message: proto::NOT_AUTHORISED.into(),
            },
        );
        return Ok(());
    }

    loop {
        let request: proto::Request = match proto::read_frame(&mut stream) {
            Ok(r) => r,
            // Clean hang-up.
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e),
        };
        let response = dispatch(request, manager);
        proto::write_frame(&mut stream, &response)?;
    }
}

fn dispatch(request: proto::Request, manager: &TunnelManager) -> proto::Response {
    let what = match &request {
        proto::Request::Ping => "ping",
        proto::Request::Status => "status",
        proto::Request::Disconnect => "disconnect",
        proto::Request::Connect(_) => "connect",
        proto::Request::ConnectMultihopEntry(_) => "connect_multihop_entry",
        proto::Request::ConnectMultihopExit(_) => "connect_multihop_exit",
    };
    // Status and ping are polled; log only the requests that change state.
    let logged = !matches!(request, proto::Request::Ping | proto::Request::Status);
    if logged {
        eprintln!("cumulusvpn-helper: {what} requested");
    }
    let started = std::time::Instant::now();
    let result = match request {
        proto::Request::Ping => {
            return proto::Response::Pong {
                version: env!("CARGO_PKG_VERSION").to_string(),
            }
        }
        proto::Request::Status => Ok(manager.status()),
        proto::Request::Disconnect => manager.disconnect(),
        proto::Request::Connect(r) => manager.connect_request(&r),
        proto::Request::ConnectMultihopEntry(r) => manager.connect_multihop_entry_request(&r),
        proto::Request::ConnectMultihopExit(r) => manager.connect_multihop_exit_request(&r),
    };
    if logged {
        eprintln!(
            "cumulusvpn-helper: {what} {} in {} ms",
            if result.is_ok() { "done" } else { "failed" },
            started.elapsed().as_millis()
        );
        #[cfg(any(windows, target_os = "macos"))]
        crate::logfile::rotate_if_full();
    }
    match result {
        Ok(status) => proto::Response::Status(Box::new(status)),
        Err(e) => {
            eprintln!("cumulusvpn-helper: {what} failed: {e}");
            proto::Response::Error {
                message: e.to_string(),
            }
        }
    }
}

/// One `Ping` over an already-open connection, for `--ping` on Linux and
/// Windows: what an operator (or CI) runs to see whether the daemon is up and
/// whether it would serve this process.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn ping<S: Read + Write>(stream: &mut S) -> Result<String, String> {
    proto::write_frame(stream, &proto::Request::Ping).map_err(|e| format!("write: {e}"))?;
    match proto::read_frame::<_, proto::Response>(stream) {
        Ok(proto::Response::Pong { version }) => Ok(version),
        Ok(proto::Response::Error { message }) => Err(format!("refused: {message}")),
        Ok(other) => Err(format!("unexpected reply: {other:?}")),
        Err(e) => Err(format!("read: {e}")),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;

    fn accept_everyone() -> Authenticator<UnixStream> {
        Arc::new(|_: &UnixStream| Ok(()))
    }

    fn refuse_everyone() -> Authenticator<UnixStream> {
        Arc::new(|_: &UnixStream| Err("test: refused".into()))
    }

    fn temp_socket(tag: &str) -> String {
        let path = std::env::temp_dir().join(format!(
            "cvpn-{tag}-{}-{:?}.sock",
            std::process::id(),
            std::thread::current().id()
        ));
        path.to_str().expect("utf-8 temp path").to_string()
    }

    /// Exercise the real accept/serve loop over a real socket. Root is not
    /// needed as long as nothing asks the tunnel to actually do anything —
    /// `Ping` and `Status` on a down tunnel touch no privileged state — so the
    /// daemon's request path stays testable in CI.
    fn with_daemon<T>(
        auth: Authenticator<UnixStream>,
        body: impl FnOnce(&mut UnixStream) -> T,
    ) -> T {
        let path = temp_socket("helper-test");
        let listener = bind_socket(&path, 0o600, None).expect("bind");
        let manager = Arc::new(TunnelManager::new());
        thread::spawn(move || serve_forever(listener, manager, auth));

        let mut client = UnixStream::connect(&path).expect("connect");
        let out = body(&mut client);
        let _ = fs::remove_file(&path);
        out
    }

    #[test]
    fn ping_is_answered_with_the_helper_version() {
        with_daemon(accept_everyone(), |client| {
            assert_eq!(ping(client), Ok(env!("CARGO_PKG_VERSION").to_string()));
        });
    }

    /// A fresh daemon reports a down tunnel rather than erroring — the app polls
    /// this every 1.5s from launch, long before anything is connected.
    #[test]
    fn status_on_a_fresh_daemon_reports_down() {
        with_daemon(accept_everyone(), |client| {
            proto::write_frame(client, &proto::Request::Status).expect("write");
            match proto::read_frame::<_, proto::Response>(client).expect("read") {
                proto::Response::Status(s) => {
                    assert_eq!(s.state, proto::TunnelState::Down);
                    assert!(s.error.is_none());
                }
                other => panic!("expected Status, got {other:?}"),
            }
        });
    }

    /// The connection is a session, not a one-shot: the app keeps it open across
    /// every poll, so a second request on the same stream must be served.
    #[test]
    fn a_connection_serves_more_than_one_request() {
        with_daemon(accept_everyone(), |client| {
            for _ in 0..3 {
                proto::write_frame(client, &proto::Request::Status).expect("write");
                let resp: proto::Response = proto::read_frame(client).expect("read");
                assert!(matches!(resp, proto::Response::Status(_)));
            }
        });
    }

    /// The privilege boundary. A refused peer is told "not authorised" before it
    /// has sent anything, and the connection is closed. A request it sends
    /// anyway is never served: the next read is end-of-stream, not a reply.
    #[test]
    fn a_refused_peer_never_reaches_dispatch() {
        with_daemon(refuse_everyone(), |client| {
            match proto::read_frame::<_, proto::Response>(client).expect("read refusal") {
                proto::Response::Error { message } => {
                    assert_eq!(message, proto::NOT_AUTHORISED)
                }
                other => panic!("expected a refusal, got {other:?}"),
            }
            // The write may or may not fail, depending on how fast the close
            // lands. Either way the request must go unanswered.
            let _ = proto::write_frame(client, &proto::Request::Ping);
            let next = proto::read_frame::<_, proto::Response>(client);
            assert!(next.is_err(), "refused peer was served: {next:?}");
        });
    }

    /// What `--ping` prints for a refused process: the refusal, not a version.
    #[test]
    fn ping_reports_a_refusal_as_such() {
        with_daemon(refuse_everyone(), |client| {
            let result = ping(client);
            assert_eq!(result, Err(format!("refused: {}", proto::NOT_AUTHORISED)));
        });
    }

    /// A malformed request must not be "served" with a guess: the daemon
    /// validates before acting, and says why.
    #[test]
    fn a_connect_with_a_hostile_endpoint_is_refused_before_anything_moves() {
        with_daemon(accept_everyone(), |client| {
            let req = proto::Request::Connect(Box::new(proto::ConnectRequest {
                country: "DE".into(),
                wg_config: String::new(),
                endpoint: "203.0.113.7 } accept; #:51820".into(),
                assigned_ip: "10.8.0.2".into(),
                kill_switch: true,
                tls: None,
                split: None,
            }));
            proto::write_frame(client, &req).expect("write");
            match proto::read_frame::<_, proto::Response>(client).expect("read") {
                proto::Response::Error { message } => {
                    assert!(message.contains("endpoint"), "{message}")
                }
                other => panic!("expected a refusal, got {other:?}"),
            }
            // And the tunnel never left Down.
            proto::write_frame(client, &proto::Request::Status).expect("write");
            match proto::read_frame::<_, proto::Response>(client).expect("read") {
                proto::Response::Status(s) => assert_eq!(s.state, proto::TunnelState::Down),
                other => panic!("expected Status, got {other:?}"),
            }
        });
    }

    /// Rebinding must succeed over a socket file left behind by an unclean exit,
    /// or the daemon never comes back after a crash.
    #[test]
    fn binding_replaces_a_stale_socket() {
        let path = temp_socket("stale");
        let first = bind_socket(&path, 0o600, None).expect("first bind");
        drop(first);
        // The file survives the drop; a naive bind would fail with EADDRINUSE.
        assert!(std::path::Path::new(&path).exists());
        let second = bind_socket(&path, 0o600, None);
        assert!(second.is_ok(), "stale socket not replaced: {second:?}");
        let _ = fs::remove_file(&path);
    }

    /// The socket ends up with exactly the requested mode, whatever the umask
    /// of whoever started the daemon.
    #[test]
    fn the_socket_gets_exactly_the_requested_mode() {
        use std::os::unix::fs::PermissionsExt;
        for mode in [0o600, 0o660, 0o666] {
            let path = temp_socket(&format!("mode{mode:o}"));
            let _listener = bind_socket(&path, mode, None).expect("bind");
            let got = fs::metadata(&path).expect("stat").permissions().mode() & 0o777;
            assert_eq!(got, mode, "mode {mode:o}");
            let _ = fs::remove_file(&path);
        }
    }
}
