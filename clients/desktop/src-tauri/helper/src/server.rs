//! The helper's socket server: bind, authenticate each peer, serve requests.
//!
//! Compiled on every Unix, but `main` runs it only on macOS. On Linux it exists
//! so these tests run in CI: the accept/serve loop needs no root as long as
//! nothing asks the tunnel to actually move, so the daemon's request path stays
//! covered on the platform CI runs on.
//!
//! The authenticator is a parameter rather than a hard call to
//! `peer::authenticate`. Production passes exactly that (see `main`), and tests
//! pass a stand-in. The tests do not depend on the build profile or on a real
//! signature, and they can assert the property that matters most: a refused
//! peer never reaches [`dispatch`].

// Only `main` on macOS calls into this module; elsewhere it is test-only.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::Arc;
use std::thread;

use cumulusvpn_protocol as proto;
use cumulusvpn_tunnel::TunnelManager;

/// Decides whether the process on the other end of a connection may use the
/// daemon. `Err` carries the reason, which is logged but never sent to the peer.
pub type Authenticator = fn(&UnixStream) -> Result<(), String>;

/// Bind the listening socket, replacing a stale one left by an unclean exit.
///
/// Mode 0666 is deliberate and safe only because of the code-signature check in
/// `peer::authenticate`: the app runs as the logged-in user (and there may be
/// several), so file permissions cannot express "our app and nothing else".
/// Identity is proven cryptographically instead.
pub fn bind_socket(path: &str) -> io::Result<UnixListener> {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let listener = UnixListener::bind(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o666))?;
    Ok(listener)
}

/// Accept connections until the listener dies.
pub fn serve_forever(listener: UnixListener, manager: Arc<TunnelManager>, auth: Authenticator) {
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let manager = Arc::clone(&manager);
                // One thread per connection: the app holds at most one, and a
                // slow client must never stall the repair loop.
                thread::spawn(move || {
                    if let Err(e) = serve(s, &manager, auth) {
                        // A client hanging up mid-request is routine, not news.
                        if e.kind() != io::ErrorKind::UnexpectedEof {
                            eprintln!("cumulusvpn-helper: connection ended: {e}");
                        }
                    }
                });
            }
            Err(e) => eprintln!("cumulusvpn-helper: accept failed: {e}"),
        }
    }
}

/// Authenticate the peer once, then serve requests until it hangs up.
fn serve(stream: UnixStream, manager: &TunnelManager, auth: Authenticator) -> io::Result<()> {
    // Before anything else. An unauthenticated peer never reaches `dispatch`.
    if let Err(reason) = auth(&stream) {
        eprintln!("cumulusvpn-helper: rejected peer: {reason}");
        let mut s = stream;
        let _ = proto::write_frame(
            &mut s,
            &proto::Response::Error {
                message: "not authorised".into(),
            },
        );
        return Ok(());
    }

    let mut reader = stream.try_clone()?;
    let mut writer = stream;
    loop {
        let request: proto::Request = match proto::read_frame(&mut reader) {
            Ok(r) => r,
            // Clean hang-up.
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e),
        };
        let response = dispatch(request, manager);
        proto::write_frame(&mut writer, &response)?;
    }
}

fn dispatch(request: proto::Request, manager: &TunnelManager) -> proto::Response {
    let result = match request {
        proto::Request::Ping => {
            return proto::Response::Pong {
                version: env!("CARGO_PKG_VERSION").to_string(),
            }
        }
        proto::Request::Status => Ok(manager.status()),
        proto::Request::Disconnect => manager.disconnect(),
        proto::Request::Connect(r) => manager.connect_request(&r),
        proto::Request::ConnectMultihop(r) => manager.connect_multihop_request(&r),
    };
    match result {
        Ok(status) => proto::Response::Status(Box::new(status)),
        Err(e) => proto::Response::Error {
            message: e.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accept_everyone(_: &UnixStream) -> Result<(), String> {
        Ok(())
    }

    fn refuse_everyone(_: &UnixStream) -> Result<(), String> {
        Err("test: refused".into())
    }

    /// Exercise the real accept/serve loop over a real socket. Root is not
    /// needed as long as nothing asks the tunnel to actually do anything —
    /// `Ping` and `Status` on a down tunnel touch no privileged state — so the
    /// daemon's request path stays testable in CI.
    fn with_daemon<T>(auth: Authenticator, body: impl FnOnce(&mut UnixStream) -> T) -> T {
        let path = std::env::temp_dir().join(format!(
            "cvpn-helper-test-{}-{:?}.sock",
            std::process::id(),
            std::thread::current().id()
        ));
        let path = path.to_str().expect("utf-8 temp path").to_string();
        let listener = bind_socket(&path).expect("bind");
        let manager = Arc::new(TunnelManager::new());
        thread::spawn(move || serve_forever(listener, manager, auth));

        let mut client = UnixStream::connect(&path).expect("connect");
        let out = body(&mut client);
        let _ = fs::remove_file(&path);
        out
    }

    #[test]
    fn ping_is_answered_with_the_helper_version() {
        with_daemon(accept_everyone, |client| {
            proto::write_frame(client, &proto::Request::Ping).expect("write");
            match proto::read_frame::<_, proto::Response>(client).expect("read") {
                proto::Response::Pong { version } => {
                    assert_eq!(version, env!("CARGO_PKG_VERSION"));
                }
                other => panic!("expected Pong, got {other:?}"),
            }
        });
    }

    /// A fresh daemon reports a down tunnel rather than erroring — the app polls
    /// this every 1.5s from launch, long before anything is connected.
    #[test]
    fn status_on_a_fresh_daemon_reports_down() {
        with_daemon(accept_everyone, |client| {
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
        with_daemon(accept_everyone, |client| {
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
        with_daemon(refuse_everyone, |client| {
            match proto::read_frame::<_, proto::Response>(client).expect("read refusal") {
                proto::Response::Error { message } => assert_eq!(message, "not authorised"),
                other => panic!("expected a refusal, got {other:?}"),
            }
            // The write may or may not fail, depending on how fast the close
            // lands. Either way the request must go unanswered.
            let _ = proto::write_frame(client, &proto::Request::Ping);
            let next = proto::read_frame::<_, proto::Response>(client);
            assert!(next.is_err(), "refused peer was served: {next:?}");
        });
    }

    /// Rebinding must succeed over a socket file left behind by an unclean exit,
    /// or the daemon never comes back after a crash.
    #[test]
    fn binding_replaces_a_stale_socket() {
        let path = std::env::temp_dir().join(format!("cvpn-stale-{}.sock", std::process::id()));
        let path = path.to_str().expect("utf-8").to_string();
        let first = bind_socket(&path).expect("first bind");
        drop(first);
        // The file survives the drop; a naive bind would fail with EADDRINUSE.
        assert!(std::path::Path::new(&path).exists());
        let second = bind_socket(&path);
        assert!(second.is_ok(), "stale socket not replaced: {second:?}");
        let _ = fs::remove_file(&path);
    }
}
