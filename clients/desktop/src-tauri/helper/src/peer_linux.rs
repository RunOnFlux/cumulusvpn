//! Who is allowed to talk to the Linux daemon.
//!
//! **The boundary is group membership, enforced by the kernel.** The socket is
//! `root:cumulusvpn` mode 0660 under the root-owned `/run/cumulusvpn`, so
//! `connect()` fails with `EACCES` for any process that is neither root nor in
//! the `cumulusvpn` group. The package's postinst creates the group and adds the
//! installing user (`linux/postinst.sh`); that is the "users allowed to drive
//! the VPN" decision, made once by an administrator. It is the same model as
//! the docker and libvirt sockets, and the most standard one available without
//! a D-Bus/polkit dependency in a root daemon.
//!
//! Two checks then run on every connection, from the kernel's own record of the
//! peer (`SO_PEERCRED`, which cannot be forged by the peer):
//!
//! 1. **Credentials again.** Root is served. Anyone else must hold the group in
//!    their process credentials. This only matters if the socket's mode or
//!    group were ever loosened, and costs nothing.
//! 2. **The executable is the installed app** (`/proc/<pid>/exe` is
//!    `/usr/bin/cumulusvpn-desktop`, or the app next to this helper in a
//!    development tree). This keeps casual misuse out — a script or a stray
//!    tool run by a group member cannot drive the daemon — but it is defence in
//!    depth, not a boundary: a process can `exec` the app after connecting, and
//!    a user can always inject into their own processes (`LD_PRELOAD`,
//!    `ptrace`). Unlike macOS, Linux has no code-signing identity to pin, so a
//!    user in the group is trusted to use the VPN, which is what the group
//!    means. What such a user can ask for is narrow (connect, disconnect,
//!    status), and every request is shape-checked before it touches anything
//!    (`cumulusvpn_tunnel::validate`).
//!
//! The parsing below is pure and compiled on every host so it is tested in CI;
//! only [`authenticate`] and its syscalls are Linux-only.

use std::path::{Path, PathBuf};

use cumulusvpn_protocol as proto;

/// Where the packages install the app (`deb`/`rpm`: Tauri puts the main binary
/// in `/usr/bin`).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const INSTALLED_APP: &str = "/usr/bin/cumulusvpn-desktop";

/// The supplementary group ids in a `/proc/<pid>/status` text (`Groups:` line).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn supplementary_groups(status: &str) -> Vec<u32> {
    status
        .lines()
        .find_map(|l| l.strip_prefix("Groups:"))
        .map(|rest| {
            rest.split_whitespace()
                .filter_map(|g| g.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Whether `exe` (a `/proc/<pid>/exe` target) is one of the `allowed` paths.
/// A binary replaced since the process started reads `<path> (deleted)`; only
/// root can put a file at an allowed path, so the suffix is ignored.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn is_allowed_exe(exe: &str, allowed: &[PathBuf]) -> bool {
    let exe = exe.strip_suffix(" (deleted)").unwrap_or(exe);
    allowed.iter().any(|a| Path::new(exe) == a)
}

/// The app executables this helper serves: the packaged path, plus the app
/// sitting next to this helper (a `cargo build` tree, where both land in
/// `target/<profile>/`). Both are canonicalised where they exist.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn allowed_apps(helper_exe: Option<&Path>) -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from(INSTALLED_APP)];
    if let Some(dir) = helper_exe.and_then(Path::parent) {
        out.push(dir.join(proto::APP_BINARY_NAME));
    }
    for path in out.iter_mut() {
        if let Ok(real) = std::fs::canonicalize(&*path) {
            *path = real;
        }
    }
    out.dedup();
    out
}

#[cfg(target_os = "linux")]
pub use imp::{authenticate, group_id};

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use std::ffi::CString;
    use std::os::unix::io::AsRawFd;
    use std::os::unix::net::UnixStream;

    /// The numeric id of `name`, if the group exists.
    pub fn group_id(name: &str) -> Option<u32> {
        let cname = CString::new(name).ok()?;
        let mut grp: libc::group = unsafe { std::mem::zeroed() };
        let mut buf = vec![0 as libc::c_char; 16 * 1024];
        let mut result: *mut libc::group = std::ptr::null_mut();
        // SAFETY: every pointer is valid for the call; `buf` backs the strings
        // `grp` points into and outlives our only read (`gr_gid`).
        let rc = unsafe {
            libc::getgrnam_r(
                cname.as_ptr(),
                &mut grp,
                buf.as_mut_ptr(),
                buf.len(),
                &mut result,
            )
        };
        if rc != 0 || result.is_null() {
            return None;
        }
        Some(grp.gr_gid)
    }

    fn peer_cred(stream: &UnixStream) -> Result<libc::ucred, String> {
        let mut cred = libc::ucred {
            pid: 0,
            uid: 0,
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
            return Err(format!(
                "cannot read peer credentials: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(cred)
    }

    /// Serve root; otherwise require the group and the installed app.
    /// `group` is `None` when the group does not exist, in which case only root
    /// is served (and the socket is root-only anyway, see `main`).
    pub fn authenticate(stream: &UnixStream, group: Option<u32>) -> Result<(), String> {
        let cred = peer_cred(stream)?;
        if cred.uid == 0 {
            return Ok(());
        }
        let group = group.ok_or_else(|| {
            format!(
                "uid {} refused: the {} group does not exist, so only root is served",
                cred.uid,
                proto::LINUX_GROUP
            )
        })?;
        let proc_dir = PathBuf::from(format!("/proc/{}", cred.pid));
        // Fail closed if the process is already gone.
        let status = std::fs::read_to_string(proc_dir.join("status"))
            .map_err(|e| format!("pid {}: cannot read status: {e}", cred.pid))?;
        if cred.gid != group && !supplementary_groups(&status).contains(&group) {
            return Err(format!(
                "uid {} (pid {}) is not in the {} group",
                cred.uid,
                cred.pid,
                proto::LINUX_GROUP
            ));
        }
        let exe = std::fs::read_link(proc_dir.join("exe"))
            .map_err(|e| format!("pid {}: cannot read executable: {e}", cred.pid))?;
        let helper = std::env::current_exe().ok();
        let allowed = allowed_apps(helper.as_deref());
        if !is_allowed_exe(&exe.to_string_lossy(), &allowed) {
            return Err(format!(
                "pid {} runs {}, not the CumulusVPN app",
                cred.pid,
                exe.display()
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATUS: &str = "Name:\tcumulusvpn-desk\nUmask:\t0022\nState:\tS (sleeping)\n\
                          Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n\
                          FDSize:\t64\nGroups:\t4 24 27 998 1000 \nNStgid:\t4242\n";

    #[test]
    fn supplementary_groups_are_read_from_proc_status() {
        assert_eq!(supplementary_groups(STATUS), vec![4, 24, 27, 998, 1000]);
        assert!(supplementary_groups("Name:\tx\nGroups:\t\n").is_empty());
        assert!(supplementary_groups("Name:\tx\n").is_empty());
    }

    #[test]
    fn only_the_installed_app_is_allowed() {
        let allowed = vec![
            PathBuf::from(INSTALLED_APP),
            PathBuf::from("/home/dev/src-tauri/target/debug/cumulusvpn-desktop"),
        ];
        assert!(is_allowed_exe("/usr/bin/cumulusvpn-desktop", &allowed));
        assert!(is_allowed_exe(
            "/home/dev/src-tauri/target/debug/cumulusvpn-desktop",
            &allowed
        ));
        // Upgraded under a running app: still the installed path.
        assert!(is_allowed_exe(
            "/usr/bin/cumulusvpn-desktop (deleted)",
            &allowed
        ));
        // Anything else a group member might run.
        for other in [
            "/usr/bin/python3.12",
            "/usr/bin/nc.openbsd",
            "/tmp/cumulusvpn-desktop",
            "/tmp/.mount_CumulusXyz/usr/bin/cumulusvpn-desktop",
            "/usr/bin/cumulusvpn-desktop-evil",
            "",
        ] {
            assert!(!is_allowed_exe(other, &allowed), "allowed {other}");
        }
    }

    #[test]
    fn the_app_next_to_the_helper_is_allowed_too() {
        let apps = allowed_apps(Some(Path::new("/opt/x/cumulusvpn-helper")));
        assert!(apps.contains(&PathBuf::from("/opt/x/cumulusvpn-desktop")));
        assert!(apps.iter().any(|p| p.ends_with("cumulusvpn-desktop")));
        assert_eq!(allowed_apps(None).len(), 1);
    }

    /// The installed path is where Tauri's deb/rpm bundlers put the main
    /// binary: `/usr/bin/<cargo package name>`. Pinned so a rename of either
    /// fails here rather than as "not authorised" on a user's machine.
    #[test]
    fn the_installed_path_is_the_packaged_app_binary() {
        assert_eq!(
            INSTALLED_APP,
            format!("/usr/bin/{}", proto::APP_BINARY_NAME)
        );
        let manifest =
            std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../Cargo.toml"))
                .expect("app Cargo.toml");
        assert!(
            manifest.contains(&format!("name = \"{}\"", proto::APP_BINARY_NAME)),
            "the app package is no longer named {}",
            proto::APP_BINARY_NAME
        );
        let conf = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../tauri.conf.json"),
        )
        .expect("tauri.conf.json");
        assert!(
            !conf.contains("mainBinaryName"),
            "mainBinaryName renames the installed app; update APP_BINARY_NAME"
        );
    }
}
