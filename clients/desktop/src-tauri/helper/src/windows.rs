//! The Windows daemon: a LocalSystem service (`CumulusVPNHelper`) serving the
//! app on the named pipe `\\.\pipe\CumulusVPN.Helper`.
//!
//! ```text
//! cumulusvpn-helper.exe            run as the service (started by the SCM only)
//! cumulusvpn-helper.exe --console  run in the foreground, for debugging, from an
//!                                  elevated prompt with the service stopped
//! cumulusvpn-helper.exe --cleanup  undo what a crashed session left behind, then
//!                                  exit (the uninstallers run it, service stopped)
//! cumulusvpn-helper.exe --ping     ask the running service for its version; prints
//!                                  the refusal instead if it would not serve us
//! cumulusvpn-helper.exe --filters  how many WFP filters the kill switch and the
//!                                  DNS leak block hold (elevated)
//! ```
//!
//! A tunnel needs the helper to run as LocalSystem: wireguard-go creates its
//! UAPI pipe owned by SYSTEM, which only a SYSTEM process can do. `--console`
//! runs as the elevated user, so it serves the pipe and its requests, and
//! refuses a connect up front with that reason.
//!
//! The installers register the service (`windows/hooks.nsh` for NSIS,
//! `windows/helper-service.wxs` for MSI): automatic start, restart on failure.
//!
//! **Lifecycle, mirroring the macOS helper.** The service owns the tunnel, the
//! kill switch, DNS and the repair loop, and outlives the app: a clean quit of
//! the app disconnects (the app asks for it), a killed app (`taskkill /F`)
//! leaves the tunnel up and healing, and the relaunched app reattaches to it.
//! Stopping the service — `sc stop`, an upgrade, uninstall, system shutdown —
//! disconnects first. A service that crashed is restarted by the SCM, and the
//! new instance cleans up after the old one before serving anyone
//! (`TunnelManager::recover_stale`): DNS rules, a kill switch whose
//! `DefaultOutboundAction Block` would otherwise even outlive a reboot, and the
//! orphaned `wireguard-go.exe`, which Windows does not kill with its parent.

use std::ffi::c_void;
use std::io;
use std::ptr;
use std::sync::atomic::{AtomicPtr, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, OnceLock};
use std::thread;

use windows_sys::core::PWSTR;
use windows_sys::Win32::Foundation::{
    GetLastError, ERROR_CALL_NOT_IMPLEMENTED, ERROR_FAILED_SERVICE_CONTROLLER_CONNECT,
    ERROR_SERVICE_SPECIFIC_ERROR, NO_ERROR,
};
use windows_sys::Win32::System::Services::{
    RegisterServiceCtrlHandlerExW, SetServiceStatus, StartServiceCtrlDispatcherW,
    SERVICE_ACCEPT_SHUTDOWN, SERVICE_ACCEPT_STOP, SERVICE_CONTROL_INTERROGATE,
    SERVICE_CONTROL_SHUTDOWN, SERVICE_CONTROL_STOP, SERVICE_RUNNING, SERVICE_START_PENDING,
    SERVICE_STATUS, SERVICE_STOPPED, SERVICE_STOP_PENDING, SERVICE_TABLE_ENTRYW,
    SERVICE_WIN32_OWN_PROCESS,
};

use cumulusvpn_protocol as proto;
use cumulusvpn_tunnel::{spawn_repair_loop, TunnelManager};

use crate::pipe::{self, Pipe, PipeListener};
use crate::{peer_windows, server};

pub fn main() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None => run_service(),
        Some("--console") => console(),
        Some("--cleanup") => cleanup(),
        Some("--ping") => ping(),
        Some("--filters") => filters(),
        Some("--version") => {
            println!("cumulusvpn-helper {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Some(other) => {
            eprintln!(
                "cumulusvpn-helper: unknown argument {other:?}\n\
                 usage: cumulusvpn-helper [--console | --cleanup | --ping | --filters | --version]"
            );
            2
        }
    }
}

/// Bring the daemon up: clean up after a previous instance, take the pipe name,
/// start the repair loop and the listener. Shared by the service and
/// `--console` (which names Administrators as the pipe's owner; see
/// `peer_windows::console_sddl`).
fn start(console: bool) -> io::Result<Arc<TunnelManager>> {
    let manager = Arc::new(TunnelManager::new());
    manager.recover_stale();
    let sddl = if console {
        peer_windows::console_sddl()
    } else {
        peer_windows::PIPE_SDDL.to_string()
    };
    // Fails if the name is taken: another instance, or a squatter. Refusing to
    // start is the safe answer to both.
    let listener = PipeListener::bind(proto::PIPE_NAME, &sddl)?;
    spawn_repair_loop(Arc::clone(&manager));
    let serving = Arc::clone(&manager);
    let auth: server::Authenticator<Pipe> = Arc::new(peer_windows::authenticate);
    thread::spawn(move || pipe::serve_forever(listener, serving, auth));
    Ok(manager)
}

// ---- the service -------------------------------------------------------------

static STATUS_HANDLE: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
static CHECKPOINT: AtomicU32 = AtomicU32::new(0);
static STOP: OnceLock<mpsc::Sender<()>> = OnceLock::new();

/// The service-specific exit code reported when the daemon cannot start.
const EXIT_START_FAILED: u32 = 1;

fn run_service() -> i32 {
    let mut name = pipe::to_wide(proto::WINDOWS_SERVICE_NAME);
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: name.as_mut_ptr(),
            lpServiceProc: Some(service_main),
        },
        // The table is terminated by an all-null entry.
        SERVICE_TABLE_ENTRYW {
            lpServiceName: ptr::null_mut(),
            lpServiceProc: None,
        },
    ];
    // SAFETY: `table` (and the name it points to) outlives the call, which
    // returns only once the service has stopped.
    if unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) } == 0 {
        // SAFETY: plain read of the thread's last error.
        let err = unsafe { GetLastError() };
        if err == ERROR_FAILED_SERVICE_CONTROLLER_CONNECT {
            eprintln!(
                "cumulusvpn-helper is the {} Windows service and is started by the \
                 Service Control Manager. To debug, stop the service and run \
                 `cumulusvpn-helper.exe --console` from an elevated prompt.",
                proto::WINDOWS_SERVICE_NAME
            );
            return 2;
        }
        eprintln!("cumulusvpn-helper: service dispatcher failed (error {err})");
        return 1;
    }
    0
}

fn report(state: u32, win32_exit: u32, specific_exit: u32, wait_hint_ms: u32) {
    let handle = STATUS_HANDLE.load(Ordering::SeqCst);
    if handle.is_null() {
        return;
    }
    let pending = state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING;
    let status = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: if state == SERVICE_RUNNING {
            SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
        } else {
            0
        },
        dwWin32ExitCode: win32_exit,
        dwServiceSpecificExitCode: specific_exit,
        dwCheckPoint: if pending {
            CHECKPOINT.fetch_add(1, Ordering::SeqCst) + 1
        } else {
            0
        },
        dwWaitHint: wait_hint_ms,
    };
    // SAFETY: a handle from RegisterServiceCtrlHandlerExW and a valid status.
    unsafe { SetServiceStatus(handle, &status) };
}

/// Point the service's stderr — everything the daemon and the tunnel engine
/// report with `eprintln!` — at `helper.log` next to the executable: the install
/// directory, writable only by Administrators and SYSTEM. Rust looks the handle
/// up on every write, so this covers every later line. The log is capped
/// (`crate::logfile`).
fn log_to_install_dir() {
    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("helper.log")))
    {
        crate::logfile::install(&path);
    }
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    eprintln!(
        "cumulusvpn-helper: service starting at {secs} (pid {})",
        std::process::id()
    );
}

unsafe extern "system" fn service_main(_argc: u32, _argv: *mut PWSTR) {
    log_to_install_dir();
    let name = pipe::to_wide(proto::WINDOWS_SERVICE_NAME);
    // SAFETY: NUL-terminated name, a valid handler, no context.
    let handle =
        unsafe { RegisterServiceCtrlHandlerExW(name.as_ptr(), Some(control_handler), ptr::null()) };
    if handle.is_null() {
        return;
    }
    STATUS_HANDLE.store(handle, Ordering::SeqCst);
    // Startup recovery runs PowerShell a few times (firewall, DNS, sidecars),
    // which is seconds on a cold boot; say so rather than look hung.
    report(SERVICE_START_PENDING, NO_ERROR, 0, 60_000);

    let (tx, rx) = mpsc::channel();
    let _ = STOP.set(tx);

    let manager = match start(false) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("cumulusvpn-helper: cannot start: {e}");
            report(
                SERVICE_STOPPED,
                ERROR_SERVICE_SPECIFIC_ERROR,
                EXIT_START_FAILED,
                0,
            );
            return;
        }
    };
    report(SERVICE_RUNNING, NO_ERROR, 0, 0);

    // Block until the SCM asks us to stop (or the system shuts down).
    let _ = rx.recv();
    report(SERVICE_STOP_PENDING, NO_ERROR, 0, 30_000);
    // Only if something is up: stopping an idle service must not touch the
    // firewall. A shutdown that cuts this short is cleaned up by the next
    // start's recovery.
    manager.disconnect_if_active();
    report(SERVICE_STOPPED, NO_ERROR, 0, 0);
    // Returning lets StartServiceCtrlDispatcherW return in `run_service`, and
    // the process exits with the listener thread still parked in
    // ConnectNamedPipe — which is fine; there is nothing left to serve.
}

unsafe extern "system" fn control_handler(
    control: u32,
    _event_type: u32,
    _event_data: *mut c_void,
    _context: *mut c_void,
) -> u32 {
    match control {
        SERVICE_CONTROL_STOP | SERVICE_CONTROL_SHUTDOWN => {
            if let Some(tx) = STOP.get() {
                let _ = tx.send(());
            }
            NO_ERROR
        }
        SERVICE_CONTROL_INTERROGATE => NO_ERROR,
        _ => ERROR_CALL_NOT_IMPLEMENTED,
    }
}

// ---- the command-line modes --------------------------------------------------

/// Open the pipe as the app does: its exact access mask, and identification
/// only (the server may not impersonate us).
fn open_pipe() -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .access_mode(proto::PIPE_CLIENT_ACCESS)
        .security_qos_flags(windows_sys::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION)
        .open(proto::PIPE_NAME)
}

/// `--console`: the daemon in the foreground. Ctrl+C ends the process without
/// a disconnect; `--cleanup` afterwards (or the next service start) clears
/// what it leaves.
fn console() -> i32 {
    match start(true) {
        Ok(_manager) => {
            println!(
                "cumulusvpn-helper: serving {} (Ctrl+C to stop)",
                proto::PIPE_NAME
            );
            loop {
                thread::park();
            }
        }
        Err(e) => {
            eprintln!(
                "cumulusvpn-helper: cannot start: {e} (is the {} service still running?)",
                proto::WINDOWS_SERVICE_NAME
            );
            1
        }
    }
}

/// `--cleanup`: the startup recovery on its own, for the uninstallers (service
/// already stopped) and for an operator after a crash. Refuses while the
/// service answers, because then the "stale" state is a live session.
fn cleanup() -> i32 {
    if open_pipe().is_ok() {
        eprintln!(
            "cumulusvpn-helper: the helper is running; stop it first \
             (sc stop {}) — it cleans up on stop",
            proto::WINDOWS_SERVICE_NAME
        );
        return 1;
    }
    TunnelManager::new().recover_stale();
    println!("cumulusvpn-helper: stale tunnel state cleaned up");
    0
}

/// `--filters`: how many WFP filters the kill switch and the DNS leak block
/// hold (elevated). Exit 0, or 1 when the filtering engine cannot be read.
fn filters() -> i32 {
    match cumulusvpn_tunnel::windows_filter_counts() {
        Ok((kill_switch, dns)) => {
            println!("kill switch: {kill_switch} filters");
            println!("DNS leak block: {dns} filters");
            0
        }
        Err(e) => {
            println!("cannot read the filtering engine: {e}");
            1
        }
    }
}

/// `--ping`: one `Ping` as this process. Exit 0 on a reply; otherwise print
/// why and exit 1.
fn ping() -> i32 {
    let mut pipe = match open_pipe() {
        Ok(p) => p,
        Err(e) => {
            println!("cannot open {}: {e}", proto::PIPE_NAME);
            return 1;
        }
    };
    match server::ping(&mut pipe) {
        Ok(version) => {
            println!("cumulusvpn-helper {version} is running and serves this process");
            0
        }
        Err(e) => {
            println!("{e}");
            1
        }
    }
}
