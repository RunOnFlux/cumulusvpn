//! Client for the privileged helper daemon, on every desktop OS.
//!
//! The app holds no privileges of its own when it uses the helper: every
//! operation that touches the network stack is a request over local IPC — the
//! helper's Unix socket on macOS and Linux, its named pipe on Windows. The
//! helper owns the tunnel state, so this is a thin transport. It deliberately
//! caches nothing, because a second opinion about whether the tunnel is up is
//! exactly the kind of thing that goes stale and lies to the user.
//!
//! The connection is kept open rather than dialled per request: the helper
//! authenticates the peer on connect (on macOS a code-signature check, real
//! cryptographic work), and the status poll runs every 1.5s. A dropped
//! connection (helper restarted, upgraded, or not yet set up) is reconnected
//! transparently on the next call.
//!
//! **The app checks the helper too.** The requests carry the WireGuard private
//! key, so before sending anything the client makes sure it is talking to the
//! real daemon and not to something that took its name: on Linux the socket's
//! peer must be root (it lives in root-owned `/run/cumulusvpn` anyway), on
//! Windows the pipe must be owned by SYSTEM or Administrators. macOS trusts
//! `/var/run`, which only root can write.

use std::io;
use std::sync::Mutex;
#[cfg(unix)]
use std::time::Duration;

use cumulusvpn_protocol as proto;

#[cfg(unix)]
type Conn = std::os::unix::net::UnixStream;
#[cfg(windows)]
type Conn = std::fs::File;

/// How long to wait on the helper before giving up. Generous, because `connect`
/// legitimately takes seconds (it spawns sidecars and rewrites routes), but
/// bounded so a wedged daemon cannot hang the UI thread forever. (Unix only: a
/// synchronous Windows pipe handle cannot time out a read, so there the bound is
/// the daemon's own, which answers every request it reads.)
#[cfg(unix)]
const IO_TIMEOUT: Duration = Duration::from_secs(45);

/// Why the helper could not be used, as far as the setup UI is concerned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeError {
    /// Nothing answered: not installed, not started, or not approved yet.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unreachable(String),
    /// Something answered and refused this app (the Linux socket's group, the
    /// helper's peer check), or the endpoint is not the real helper.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Denied(String),
}

pub struct HelperClient {
    conn: Mutex<Option<Conn>>,
}

impl HelperClient {
    pub fn new() -> Self {
        HelperClient {
            conn: Mutex::new(None),
        }
    }

    /// Is the helper installed, set up and answering, and will it serve us?
    ///
    /// The app asks before offering to connect, so a missing daemon surfaces as
    /// a setup step rather than a failed connection attempt.
    pub fn probe(&self) -> Result<(), ProbeError> {
        match self.request(proto::Request::Ping) {
            Ok(proto::Response::Pong { .. }) => Ok(()),
            Ok(proto::Response::Error { message }) if message == proto::NOT_AUTHORISED => {
                Err(ProbeError::Denied(message))
            }
            Ok(other) => Err(ProbeError::Unreachable(format!(
                "unexpected reply from helper: {other:?}"
            ))),
            Err(Failure::Denied(m)) => Err(ProbeError::Denied(m)),
            Err(Failure::Unreachable(m)) => Err(ProbeError::Unreachable(m)),
        }
    }

    /// [`Self::probe`] as a yes/no.
    pub fn is_available(&self) -> bool {
        self.probe().is_ok()
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
        match self.request(req).map_err(Failure::into_message)? {
            proto::Response::Status(s) => Ok(*s),
            proto::Response::Error { message } if message == proto::NOT_AUTHORISED => {
                Err(refused_message())
            }
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
    fn request(&self, req: proto::Request) -> Result<proto::Response, Failure> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| Failure::Unreachable("helper client poisoned".into()))?;
        if guard.is_none() {
            *guard = Some(dial().map_err(Failure::from_io)?);
        }
        let retriable = matches!(req, proto::Request::Status | proto::Request::Ping);
        let result = match exchange(guard.as_mut().expect("just dialled"), &req) {
            Ok(resp) => Ok(resp),
            Err(first) => {
                *guard = None;
                if !retriable {
                    return Err(Failure::from_io(first));
                }
                let mut fresh = dial().map_err(Failure::from_io)?;
                let resp = exchange(&mut fresh, &req).map_err(Failure::from_io)?;
                *guard = Some(fresh);
                Ok(resp)
            }
        };
        // A refusal is followed by the helper closing the connection; do not
        // keep it in the pool.
        if let Ok(proto::Response::Error { message }) = &result {
            if message == proto::NOT_AUTHORISED {
                *guard = None;
            }
        }
        result
    }
}

impl Default for HelperClient {
    fn default() -> Self {
        Self::new()
    }
}

/// A transport failure, already sorted into the two cases the UI tells apart.
enum Failure {
    Unreachable(String),
    Denied(String),
}

impl Failure {
    fn from_io(e: io::Error) -> Self {
        match e.kind() {
            io::ErrorKind::PermissionDenied => Failure::Denied(describe(&e)),
            _ => Failure::Unreachable(describe(&e)),
        }
    }

    fn into_message(self) -> String {
        match self {
            Failure::Unreachable(m) | Failure::Denied(m) => m,
        }
    }
}

#[cfg(unix)]
fn dial() -> io::Result<Conn> {
    let stream = Conn::connect(proto::SOCKET_PATH)?;
    #[cfg(target_os = "linux")]
    verify_server(&stream)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    Ok(stream)
}

/// The Linux helper runs as root; a socket whose other end is not root is not
/// the helper, whatever its path.
#[cfg(target_os = "linux")]
fn verify_server(stream: &Conn) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let mut cred = libc::ucred {
        pid: 0,
        uid: u32::MAX,
        gid: 0,
    };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: `cred`/`len` are a correctly sized, writable pair for
    // SO_PEERCRED; the fd is owned by `stream` and open for the call.
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut len,
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    if cred.uid != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "{} is served by uid {}, not root; refusing to use it",
                proto::SOCKET_PATH,
                cred.uid
            ),
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn dial() -> io::Result<Conn> {
    use std::os::windows::fs::OpenOptionsExt;

    /// `ERROR_PIPE_BUSY`: every instance is mid-handoff. The helper opens a new
    /// one right after each connection, so a short wait is enough.
    const ERROR_PIPE_BUSY: i32 = 231;
    let mut attempts = 0;
    let pipe = loop {
        match std::fs::OpenOptions::new()
            .access_mode(proto::PIPE_CLIENT_ACCESS)
            // Identification only: whoever serves the pipe may learn who we
            // are, never act as us. Without this, a process that grabbed the
            // name could impersonate this user before `verify_server` runs.
            .security_qos_flags(windows_sys::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION)
            .open(proto::PIPE_NAME)
        {
            Ok(p) => break p,
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && attempts < 40 => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(e),
        }
    };
    verify_server(&pipe)?;
    Ok(pipe)
}

/// The helper's pipe is created by the LocalSystem service, so its owner is
/// SYSTEM (or Administrators, for an elevated `--console` run). An unprivileged
/// process that grabbed the name while the service was stopped would own it
/// itself, and must not be handed a WireGuard key.
#[cfg(windows)]
fn verify_server(pipe: &Conn) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use std::ptr;

    use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS};
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        IsWellKnownSid, WinBuiltinAdministratorsSid, WinLocalSystemSid, OWNER_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR, PSID,
    };

    let mut owner: PSID = ptr::null_mut();
    let mut sd: PSECURITY_DESCRIPTOR = ptr::null_mut();
    // SAFETY: a valid pipe handle opened with READ_CONTROL; the out-pointers
    // are valid, and `owner` points into `sd`, which is freed below.
    let rc = unsafe {
        GetSecurityInfo(
            pipe.as_raw_handle(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            &mut sd,
        )
    };
    if rc != ERROR_SUCCESS {
        return Err(io::Error::from_raw_os_error(rc as i32));
    }
    // SAFETY: `owner` is a valid SID inside `sd`.
    let trusted = unsafe {
        IsWellKnownSid(owner, WinLocalSystemSid) != 0
            || IsWellKnownSid(owner, WinBuiltinAdministratorsSid) != 0
    };
    // SAFETY: allocated by GetSecurityInfo with LocalAlloc; freed once.
    unsafe { LocalFree(sd) };
    if !trusted {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "{} is not owned by SYSTEM or Administrators; refusing to use it",
                proto::PIPE_NAME
            ),
        ));
    }
    Ok(())
}

fn exchange(conn: &mut Conn, req: &proto::Request) -> io::Result<proto::Response> {
    proto::write_frame(conn, req)?;
    proto::read_frame(conn)
}

/// What to say when the helper refused this app outright.
fn refused_message() -> String {
    if cfg!(target_os = "linux") {
        format!(
            "CumulusVPN's network helper refused this app. Run the installed app \
             (/usr/bin/{}), from an account in the {} group.",
            proto::APP_BINARY_NAME,
            proto::LINUX_GROUP
        )
    } else if cfg!(windows) {
        "CumulusVPN's network helper refused this app. Run CumulusVPN from its \
         install folder, or reinstall it."
            .into()
    } else {
        "CumulusVPN's network helper refused this app. Reinstall the app.".into()
    }
}

/// Turn a transport failure into something the UI can act on. "Connection
/// refused" or "no such file" means the daemon is not installed or not running
/// — by far the most likely cause, and the one with an obvious next step.
fn describe(e: &io::Error) -> String {
    match e.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused => {
            if cfg!(target_os = "linux") {
                format!(
                    "CumulusVPN's network helper is not running. Start it with: \
                     sudo systemctl enable --now {}",
                    proto::LINUX_UNIT
                )
            } else if cfg!(windows) {
                "CumulusVPN's network helper is not running. Start the \"CumulusVPN \
                 Helper\" service, or reinstall CumulusVPN."
                    .into()
            } else {
                "CumulusVPN's network helper is not running. Open Settings to finish setup.".into()
            }
        }
        io::ErrorKind::PermissionDenied => {
            if cfg!(target_os = "linux") && e.get_ref().is_none() {
                // EACCES from connect(): the socket is root:cumulusvpn 0660.
                format!(
                    "This account cannot use CumulusVPN's network helper yet. Log out \
                     and back in after installing; if that does not help, run: \
                     sudo usermod -aG {} \"$USER\"",
                    proto::LINUX_GROUP
                )
            } else if e.get_ref().is_some() {
                // Our own check of the other end (see `verify_server`).
                format!("cannot trust the network helper: {e}")
            } else {
                refused_message()
            }
        }
        _ => format!("cannot reach the network helper: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_daemon_reads_as_not_running() {
        let e = io::Error::from(io::ErrorKind::NotFound);
        assert!(
            matches!(Failure::from_io(e), Failure::Unreachable(m) if m.contains("not running"))
        );
        let e = io::Error::from(io::ErrorKind::ConnectionRefused);
        assert!(matches!(Failure::from_io(e), Failure::Unreachable(_)));
    }

    /// A socket the kernel will not let us open (Linux: not in the group yet),
    /// and an endpoint that fails our own check of the helper, are refusals,
    /// not "not installed" — the setup banner says something different.
    #[test]
    fn permission_problems_read_as_refusals() {
        let e = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(matches!(Failure::from_io(e), Failure::Denied(_)));
        let e = io::Error::new(io::ErrorKind::PermissionDenied, "not owned by SYSTEM");
        match Failure::from_io(e) {
            Failure::Denied(m) => assert!(m.contains("cannot trust"), "{m}"),
            Failure::Unreachable(m) => panic!("read as unreachable: {m}"),
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_linux_group_refusal_says_how_to_fix_it() {
        let m = describe(&io::Error::from(io::ErrorKind::PermissionDenied));
        assert!(m.contains("usermod -aG cumulusvpn"), "{m}");
        assert!(m.contains("Log out"), "{m}");
    }
}
