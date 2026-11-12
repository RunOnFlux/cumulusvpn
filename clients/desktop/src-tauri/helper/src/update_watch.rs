//! Restart into a new helper after an app update (macOS).
//!
//! The helper is a `KeepAlive` LaunchDaemon whose program lives inside the app
//! bundle (`BundleProgram`). Replacing the app — dragging a new version into
//! /Applications, or an auto-update — swaps the binary on disk, but launchd
//! keeps the **old** process running, so the new app talks to the previous
//! release's tunnel code until the next reboot. (Desktop 1.4.4 fixed connects
//! in the helper, and stayed broken on updated Macs for exactly this reason.)
//! Linux and Windows don't need this: their package scripts restart the
//! service on upgrade.
//!
//! So the daemon watches its own executable. Once the file at its launch path
//! is a different file, and **no tunnel is active**, it exits; `KeepAlive`
//! makes launchd start the new binary straight away. It never exits mid-session:
//! that would drop the user's tunnel (and a kill switch it holds) for an update
//! they did not ask to apply yet. The swap waits until they disconnect.

// The policy is compiled (and tested) everywhere; only macOS runs it.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use cumulusvpn_protocol::TunnelState;

/// Identity of the file at a path: device, inode and modification time. A
/// replaced file differs in at least one of them (a copy gets a new inode; an
/// in-place rewrite a new mtime).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileId {
    pub dev: u64,
    pub ino: u64,
    pub mtime: i64,
    pub mtime_nsec: i64,
}

/// Whether to exit so launchd starts the updated binary. `now` is `None` while
/// the path is missing (mid-copy, or the app was removed): keep running then.
pub fn should_restart(launched: FileId, now: Option<FileId>, state: TunnelState) -> bool {
    match now {
        Some(now) => now != launched && state == TunnelState::Down,
        None => false,
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{should_restart, FileId};
    use cumulusvpn_tunnel::TunnelManager;
    use std::os::unix::fs::MetadataExt;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    const POLL: Duration = Duration::from_secs(3);

    fn file_id(path: &Path) -> Option<FileId> {
        let m = std::fs::metadata(path).ok()?;
        Some(FileId {
            dev: m.dev(),
            ino: m.ino(),
            mtime: m.mtime(),
            mtime_nsec: m.mtime_nsec(),
        })
    }

    /// Absolute path of the running image. launchd starts a `BundleProgram`
    /// with a bundle-relative argv[0] (`Contents/MacOS/cumulusvpn-helper`), so
    /// ask the kernel instead of trusting argv or `current_exe`.
    fn own_path() -> Option<PathBuf> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        // SAFETY: the buffer is valid for `buf.len()` bytes and proc_pidpath
        // writes at most that many; it returns the length written, or <= 0.
        let n = unsafe {
            libc::proc_pidpath(
                libc::getpid(),
                buf.as_mut_ptr().cast(),
                u32::try_from(buf.len()).ok()?,
            )
        };
        let n = usize::try_from(n).ok().filter(|n| *n > 0)?;
        buf.truncate(n);
        Some(PathBuf::from(String::from_utf8(buf).ok()?))
    }

    pub fn spawn(manager: Arc<TunnelManager>) {
        let Some(path) = own_path() else {
            eprintln!("cumulusvpn-helper: cannot resolve own path; update watch off");
            return;
        };
        let Some(launched) = file_id(&path) else {
            return;
        };
        thread::spawn(move || loop {
            thread::sleep(POLL);
            if should_restart(launched, file_id(&path), manager.status().state) {
                eprintln!(
                    "cumulusvpn-helper: {} was updated; exiting so launchd starts the new helper",
                    path.display()
                );
                std::process::exit(0);
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub use imp::spawn;

#[cfg(test)]
mod tests {
    use super::*;

    const A: FileId = FileId {
        dev: 1,
        ino: 10,
        mtime: 100,
        mtime_nsec: 0,
    };

    #[test]
    fn same_file_never_restarts() {
        assert!(!should_restart(A, Some(A), TunnelState::Down));
    }

    #[test]
    fn a_replaced_binary_restarts_only_when_idle() {
        let copied = FileId { ino: 11, ..A };
        let rewritten = FileId { mtime_nsec: 5, ..A };
        for new in [copied, rewritten] {
            assert!(should_restart(A, Some(new), TunnelState::Down));
            for busy in [TunnelState::Up, TunnelState::Connecting, TunnelState::Error] {
                assert!(!should_restart(A, Some(new), busy), "{busy:?}");
            }
        }
    }

    #[test]
    fn a_missing_binary_keeps_running() {
        assert!(!should_restart(A, None, TunnelState::Down));
    }
}
