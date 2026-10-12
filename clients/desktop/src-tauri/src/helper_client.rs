//! Client for the privileged helper (macOS only; the module is not compiled
//! elsewhere — Linux and Windows run the tunnel in-process, see `backend.rs`).
//!
//! On macOS the app holds no privileges of its own: every operation that
//! touches the network stack is a request across this socket. The helper owns the tunnel
//! state, so this is a thin transport — it deliberately caches nothing, because
//! a second opinion about whether the tunnel is up is exactly the kind of thing
//! that goes stale and lies to the user.
//!
//! The connection is kept open rather than dialled per request: the helper
//! verifies our code signature on connect, which is real cryptographic work, and
//! the status poll runs every 1.5s. A dropped connection (helper restarted,
//! upgraded, or not yet approved) is reconnected transparently on the next call.

use std::io;
use std::os::unix::net::UnixStream;
use std::sync::Mutex;
use std::time::Duration;

use cumulusvpn_protocol as proto;

/// How long to wait on the helper before giving up. Generous, because `connect`
/// legitimately takes seconds (it spawns sidecars and rewrites routes), but
/// bounded so a wedged daemon cannot hang the UI thread forever.
const IO_TIMEOUT: Duration = Duration::from_secs(45);

pub struct HelperClient {
    conn: Mutex<Option<UnixStream>>,
}

impl HelperClient {
    pub fn new() -> Self {
        HelperClient {
            conn: Mutex::new(None),
        }
    }

    /// Is the helper installed, approved and answering?
    ///
    /// The app asks before offering to connect, so a missing daemon surfaces as
    /// "finish setup" rather than a failed connection attempt.
    pub fn is_available(&self) -> bool {
        matches!(
            self.request(proto::Request::Ping),
            Ok(proto::Response::Pong { .. })
        )
    }

    pub fn connect_tunnel(
        &self,
        req: proto::ConnectRequest,
    ) -> Result<proto::TunnelStatus, String> {
        self.status_request(proto::Request::Connect(Box::new(req)))
    }

    pub fn connect_multihop(
        &self,
        req: proto::MultihopRequest,
    ) -> Result<proto::TunnelStatus, String> {
        self.status_request(proto::Request::ConnectMultihop(Box::new(req)))
    }

    pub fn disconnect(&self) -> Result<proto::TunnelStatus, String> {
        self.status_request(proto::Request::Disconnect)
    }

    pub fn status(&self) -> Result<proto::TunnelStatus, String> {
        self.status_request(proto::Request::Status)
    }

    fn status_request(&self, req: proto::Request) -> Result<proto::TunnelStatus, String> {
        match self.request(req)? {
            proto::Response::Status(s) => Ok(*s),
            proto::Response::Error { message } => Err(message),
            proto::Response::Pong { .. } => Err("unexpected reply from helper".into()),
        }
    }

    /// Send one request, reconnecting once if the pooled connection has died.
    ///
    /// The retry is deliberately single and only covers transport failure: a
    /// helper that restarts between two polls should be invisible, but a
    /// `connect` that genuinely failed must not be silently attempted twice —
    /// that would leave two sidecars fighting over the routing table.
    fn request(&self, req: proto::Request) -> Result<proto::Response, String> {
        let mut guard = self.conn.lock().map_err(|_| "helper client poisoned")?;
        if guard.is_none() {
            *guard = Some(dial().map_err(describe)?);
        }
        let retriable = matches!(req, proto::Request::Status | proto::Request::Ping);
        match exchange(guard.as_mut().expect("just dialled"), &req) {
            Ok(resp) => Ok(resp),
            Err(first) => {
                *guard = None;
                if !retriable {
                    return Err(describe(first));
                }
                let mut fresh = dial().map_err(describe)?;
                let resp = exchange(&mut fresh, &req).map_err(describe)?;
                *guard = Some(fresh);
                Ok(resp)
            }
        }
    }
}

impl Default for HelperClient {
    fn default() -> Self {
        Self::new()
    }
}

fn dial() -> io::Result<UnixStream> {
    let stream = UnixStream::connect(proto::SOCKET_PATH)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    Ok(stream)
}

fn exchange(stream: &mut UnixStream, req: &proto::Request) -> io::Result<proto::Response> {
    proto::write_frame(stream, req)?;
    proto::read_frame(stream)
}

/// Turn a transport failure into something the UI can act on. "Connection
/// refused" or "no such file" means the daemon is not installed or not approved
/// — by far the most likely cause, and the one with an obvious next step.
fn describe(e: io::Error) -> String {
    match e.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused => {
            "CumulusVPN's network helper is not running. Open Settings to finish setup.".into()
        }
        io::ErrorKind::PermissionDenied => {
            "CumulusVPN's network helper refused this app. Reinstall the app.".into()
        }
        _ => format!("cannot reach the network helper: {e}"),
    }
}
