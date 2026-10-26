//! The Windows transport: the named pipe `\\.\pipe\CumulusVPN.Helper`.
//!
//! **Who can open it** is decided by the pipe's security descriptor
//! (`peer_windows::PIPE_SDDL`): SYSTEM and Administrators get full control; interactive
//! users (`IU`: anyone logged on at the console or over Remote Desktop) get
//! read, write-data and read-control — and *not* `FILE_CREATE_PIPE_INSTANCE`,
//! so an unprivileged process cannot add a server instance of our pipe and
//! intercept the app's requests (which carry the WireGuard private key).
//! Network clients are refused outright (`PIPE_REJECT_REMOTE_CLIENTS`), and
//! low-integrity processes (sandboxed browser renderers) cannot write to an
//! object with the default medium integrity label.
//!
//! **Nobody can squat the name.** The first instance is created with
//! `FILE_FLAG_FIRST_PIPE_INSTANCE`, so the service refuses to start if anyone
//! else already owns the name; after that the listener always keeps one idle
//! instance open (the next one is created before a connected one is handed
//! off), so the name never lapses while the service runs. The app checks the
//! other direction: it refuses a pipe that is not owned by SYSTEM or
//! Administrators (`src/helper_client.rs`).
//!
//! The pipe is synchronous and byte-mode; each connection is served on its own
//! thread by the same `server::serve` the Unix socket uses.

use std::io::{self, Read, Write};
use std::ptr;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, ERROR_BROKEN_PIPE, ERROR_NO_DATA, ERROR_PIPE_CONNECTED,
    HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
use windows_sys::Win32::Storage::FileSystem::{
    ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX,
};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
};

use cumulusvpn_tunnel::TunnelManager;

use crate::server::{self, Authenticator};

/// In and out buffer size per instance. A request is at most a few KiB.
const BUFFER: u32 = 64 * 1024;

pub fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A security descriptor from SDDL, freed on drop.
struct SecurityDescriptor(PSECURITY_DESCRIPTOR);

// SAFETY: the descriptor is an immutable, self-contained allocation after
// creation; it is only ever read (by CreateNamedPipeW) and freed once on drop.
unsafe impl Send for SecurityDescriptor {}
unsafe impl Sync for SecurityDescriptor {}

impl SecurityDescriptor {
    fn from_sddl(sddl: &str) -> io::Result<Self> {
        let wide = to_wide(sddl);
        let mut sd: PSECURITY_DESCRIPTOR = ptr::null_mut();
        // SAFETY: `wide` is NUL-terminated and outlives the call; `sd` is a
        // valid out-pointer; the size out-parameter is optional.
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide.as_ptr(),
                SDDL_REVISION_1,
                &mut sd,
                ptr::null_mut(),
            )
        };
        if ok == 0 || sd.is_null() {
            return Err(io::Error::last_os_error());
        }
        Ok(SecurityDescriptor(sd))
    }
}

impl Drop for SecurityDescriptor {
    fn drop(&mut self) {
        // SAFETY: allocated by ConvertStringSecurityDescriptor… with LocalAlloc,
        // freed exactly once.
        unsafe { LocalFree(self.0) };
    }
}

/// One server end of the pipe: a connected client, or an idle instance.
pub struct Pipe(HANDLE);

// SAFETY: a pipe handle may be used from any thread; each `Pipe` is owned by
// exactly one thread at a time.
unsafe impl Send for Pipe {}

impl Pipe {
    pub fn handle(&self) -> HANDLE {
        self.0
    }
}

impl Read for Pipe {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
        let mut read = 0u32;
        // SAFETY: `buf` is valid for `len` bytes; synchronous handle, so no
        // OVERLAPPED.
        let ok = unsafe { ReadFile(self.0, buf.as_mut_ptr(), len, &mut read, ptr::null_mut()) };
        if ok == 0 {
            // SAFETY: plain read of the thread's last error.
            let err = unsafe { GetLastError() };
            // The client closed its end: end of stream, as on a socket.
            if err == ERROR_BROKEN_PIPE {
                return Ok(0);
            }
            return Err(io::Error::from_raw_os_error(err as i32));
        }
        Ok(read as usize)
    }
}

impl Write for Pipe {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
        let mut written = 0u32;
        // SAFETY: `buf` is valid for `len` bytes; synchronous handle.
        let ok = unsafe { WriteFile(self.0, buf.as_ptr(), len, &mut written, ptr::null_mut()) };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(written as usize)
    }

    fn flush(&mut self) -> io::Result<()> {
        // Byte-mode writes land in the pipe buffer immediately. Deliberately not
        // FlushFileBuffers, which blocks until the client reads everything and
        // would pin this thread on a client that never does.
        Ok(())
    }
}

impl Drop for Pipe {
    fn drop(&mut self) {
        // Close without DisconnectNamedPipe: that would discard data the client
        // has not read yet, such as the "not authorised" refusal. The client
        // reads what is buffered, then sees end-of-stream.
        // SAFETY: we own the handle and close it once.
        unsafe { CloseHandle(self.0) };
    }
}

/// The listening side: always one idle instance waiting for the next client.
pub struct PipeListener {
    name: Vec<u16>,
    sd: SecurityDescriptor,
    idle: Option<Pipe>,
}

impl PipeListener {
    /// Create the pipe's first instance, with the security descriptor `sddl`.
    /// Fails if the name already exists — another helper is running, or
    /// something squatted the name — rather than joining someone else's pipe.
    pub fn bind(name: &str, sddl: &str) -> io::Result<Self> {
        let sd = SecurityDescriptor::from_sddl(sddl)?;
        let name = to_wide(name);
        let first = create_instance(&name, &sd, true)?;
        Ok(PipeListener {
            name,
            sd,
            idle: Some(first),
        })
    }

    /// Wait for the next client.
    pub fn accept(&mut self) -> io::Result<Pipe> {
        let pipe = match self.idle.take() {
            Some(p) => p,
            None => create_instance(&self.name, &self.sd, false)?,
        };
        loop {
            // SAFETY: valid pipe handle; synchronous, so no OVERLAPPED.
            let ok = unsafe { ConnectNamedPipe(pipe.0, ptr::null_mut()) };
            if ok != 0 {
                break;
            }
            // SAFETY: plain read of the thread's last error.
            let err = unsafe { GetLastError() };
            match err {
                // A client that connected between CreateNamedPipe and
                // ConnectNamedPipe is still a connected client.
                ERROR_PIPE_CONNECTED => break,
                // A client that connected and closed before we accepted it:
                // reset this instance and wait on it again.
                ERROR_NO_DATA => {
                    // SAFETY: valid pipe handle whose client has gone.
                    unsafe { DisconnectNamedPipe(pipe.0) };
                }
                // Keep the instance as the idle one, so the name stays ours
                // while the caller backs off.
                _ => {
                    self.idle = Some(pipe);
                    return Err(io::Error::from_raw_os_error(err as i32));
                }
            }
        }
        // Open the next instance before handing this one off, so the name
        // never lapses (see the module docs).
        match create_instance(&self.name, &self.sd, false) {
            Ok(next) => self.idle = Some(next),
            Err(e) => eprintln!("cumulusvpn-helper: cannot open the next pipe instance: {e}"),
        }
        Ok(pipe)
    }
}

fn create_instance(name: &[u16], sd: &SecurityDescriptor, first: bool) -> io::Result<Pipe> {
    let sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: sd.0,
        bInheritHandle: 0,
    };
    let open_mode = PIPE_ACCESS_DUPLEX
        | if first {
            FILE_FLAG_FIRST_PIPE_INSTANCE
        } else {
            0
        };
    // SAFETY: `name` is NUL-terminated, `sa` and the descriptor it points to
    // are valid for the call.
    let handle = unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            open_mode,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES,
            BUFFER,
            BUFFER,
            0,
            &sa,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(Pipe(handle))
}

/// Accept clients forever, one thread each.
pub fn serve_forever(
    mut listener: PipeListener,
    manager: Arc<TunnelManager>,
    auth: Authenticator<Pipe>,
) {
    loop {
        match listener.accept() {
            Ok(pipe) => {
                let manager = Arc::clone(&manager);
                let auth = Arc::clone(&auth);
                thread::spawn(move || {
                    if let Err(e) = server::serve(pipe, &manager, &*auth) {
                        server::log_connection_end(&e);
                    }
                });
            }
            Err(e) => {
                eprintln!("cumulusvpn-helper: accept failed: {e}");
                // Never spin: a persistent failure (say, the next instance
                // cannot be created) would otherwise burn a core.
                thread::sleep(Duration::from_millis(250));
            }
        }
    }
}

/// The real pipe, on Windows CI: the transport the service runs on, with the
/// production security descriptor, minus the peer check (a stand-in decides).
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, OpenOptions};
    use std::os::windows::fs::OpenOptionsExt;
    use std::sync::atomic::{AtomicU32, Ordering};

    use cumulusvpn_protocol as proto;

    use crate::peer_windows::PIPE_SDDL;

    fn unique_name() -> String {
        static N: AtomicU32 = AtomicU32::new(0);
        format!(
            r"\\.\pipe\CumulusVPN.Helper.test.{}.{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        )
    }

    fn daemon(auth: Authenticator<Pipe>) -> String {
        let name = unique_name();
        let listener = PipeListener::bind(&name, PIPE_SDDL).expect("bind");
        let manager = Arc::new(TunnelManager::new());
        thread::spawn(move || serve_forever(listener, manager, auth));
        name
    }

    /// Opened exactly as the app opens it: the access mask the descriptor
    /// grants interactive users, not GENERIC_WRITE.
    fn open(name: &str) -> File {
        OpenOptions::new()
            .access_mode(proto::PIPE_CLIENT_ACCESS)
            .security_qos_flags(windows_sys::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION)
            .open(name)
            .expect("open pipe")
    }

    #[test]
    fn the_pipe_serves_requests_over_a_session() {
        let name = daemon(Arc::new(|_: &Pipe| Ok(())));
        let mut client = open(&name);
        assert_eq!(
            server::ping(&mut client),
            Ok(env!("CARGO_PKG_VERSION").to_string())
        );
        for _ in 0..3 {
            proto::write_frame(&mut client, &proto::Request::Status).expect("write");
            match proto::read_frame::<_, proto::Response>(&mut client).expect("read") {
                proto::Response::Status(s) => assert_eq!(s.state, proto::TunnelState::Down),
                other => panic!("expected Status, got {other:?}"),
            }
        }
        // A second client while the first is connected: the listener keeps an
        // idle instance open, so it is served too.
        let mut second = open(&name);
        assert!(server::ping(&mut second).is_ok());
    }

    #[test]
    fn a_refused_client_reads_the_refusal_and_is_not_served() {
        let name = daemon(Arc::new(|_: &Pipe| Err("test: refused".into())));
        let mut client = open(&name);
        match proto::read_frame::<_, proto::Response>(&mut client).expect("read refusal") {
            proto::Response::Error { message } => assert_eq!(message, proto::NOT_AUTHORISED),
            other => panic!("expected a refusal, got {other:?}"),
        }
        let _ = proto::write_frame(&mut client, &proto::Request::Ping);
        let next = proto::read_frame::<_, proto::Response>(&mut client);
        assert!(next.is_err(), "refused client was served: {next:?}");
    }

    /// FILE_FLAG_FIRST_PIPE_INSTANCE: a second "first" instance — another
    /// helper, or a squatter that got there first — is refused, so the service
    /// never joins someone else's pipe.
    #[test]
    fn the_name_cannot_be_bound_twice() {
        let name = unique_name();
        let _first = PipeListener::bind(&name, PIPE_SDDL).expect("first bind");
        assert!(PipeListener::bind(&name, PIPE_SDDL).is_err());
    }

    /// A client that connects and closes before the listener accepts it
    /// (ERROR_NO_DATA) is skipped: the same instance waits again, and the
    /// next client is accepted on it.
    #[test]
    fn a_client_gone_before_accept_does_not_cost_the_listener() {
        let name = unique_name();
        let mut listener = PipeListener::bind(&name, PIPE_SDDL).expect("bind");
        drop(open(&name));
        let late = name.clone();
        let client = thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(200));
            open(&late)
        });
        let accepted = listener.accept();
        let _client = client.join().expect("client thread");
        assert!(accepted.is_ok(), "{:?}", accepted.err());
    }
}
