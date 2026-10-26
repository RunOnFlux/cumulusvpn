//! The daemon's log on Windows and macOS: stderr — everything the daemon and
//! the tunnel engine report with `eprintln!` — pointed at a size-capped file
//! (`cumulusvpn_tunnel::logfile`). Linux logs to the systemd journal instead,
//! which journald caps itself.
//!
//! [`install`] points stderr at the log at startup; [`rotate_if_full`], called
//! after every request that changes state, moves a full log to `<name>.1` and
//! points stderr at a fresh one.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use cumulusvpn_tunnel::logfile::{self, MAX_LOG_BYTES};

/// The log path, set once by [`install`].
static PATH: OnceLock<PathBuf> = OnceLock::new();

/// The files stderr has pointed at: the current one and the one before it. On
/// Windows stderr *is* the file's handle, so the current file must stay open;
/// the one before is closed only at the next rotation, long after any write
/// that looked up its handle has finished.
static FILES: Mutex<(Option<File>, Option<File>)> = Mutex::new((None, None));

/// Point stderr at the log at `path`, rotating it first if it is full.
pub fn install(path: &Path) {
    let Ok((file, _)) = logfile::open_capped(path, MAX_LOG_BYTES) else {
        return;
    };
    if PATH.set(path.to_path_buf()).is_err() {
        return;
    }
    point_stderr_at(file);
}

/// Rotate the log if it has reached the cap. A no-op before [`install`].
pub fn rotate_if_full() {
    let Some(path) = PATH.get() else {
        return;
    };
    if !logfile::is_full(path, MAX_LOG_BYTES) {
        return;
    }
    if let Ok((file, true)) = logfile::open_capped(path, MAX_LOG_BYTES) {
        point_stderr_at(file);
        eprintln!(
            "cumulusvpn-helper: log rotated; earlier lines are in {}",
            logfile::rotated_path(path).display()
        );
    }
}

#[cfg(windows)]
fn point_stderr_at(file: File) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::Console::{SetStdHandle, STD_ERROR_HANDLE};

    let mut files = FILES.lock().expect("log files mutex poisoned");
    // SAFETY: a valid file handle, kept open in FILES for as long as it is
    // stderr (and one rotation beyond).
    unsafe { SetStdHandle(STD_ERROR_HANDLE, file.as_raw_handle() as HANDLE) };
    let current = files.0.replace(file);
    files.1 = current;
}

#[cfg(target_os = "macos")]
fn point_stderr_at(file: File) {
    use std::os::unix::io::AsRawFd;

    let _files = FILES.lock().expect("log files mutex poisoned");
    // SAFETY: both are valid descriptors. dup2 makes fd 2 a copy of the file's
    // descriptor in one step, closing what fd 2 was; `file` itself can then
    // close.
    unsafe { libc::dup2(file.as_raw_fd(), libc::STDERR_FILENO) };
}
