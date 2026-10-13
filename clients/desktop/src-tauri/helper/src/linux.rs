//! The Linux daemon: a systemd service (`linux/cumulusvpn-helper.service`)
//! running as root, serving the app on `/run/cumulusvpn/helper.sock`.
//!
//! ```text
//! cumulusvpn-helper            run the daemon (the unit's ExecStart)
//! cumulusvpn-helper --cleanup  undo what a crashed session left behind, then exit
//!                              (the packages run it on removal, service stopped)
//! cumulusvpn-helper --ping     ask the running daemon for its version; prints the
//!                              refusal instead if it would not serve this process
//! ```
//!
//! **Lifecycle, mirroring the macOS helper.** The daemon owns the tunnel, the
//! kill switch, DNS and the repair loop, and outlives the app: a clean quit of
//! the app disconnects (the app asks for it), a killed app leaves the tunnel up
//! and healing, and the relaunched app reattaches to it. Stopping the service
//! (`systemctl stop`, package removal, shutdown) disconnects first — SIGTERM is
//! handled, not fatal. A daemon that crashed is restarted by systemd
//! (`Restart=always`), and the new instance cleans up after the old one before
//! serving anyone (`TunnelManager::recover_stale`); its sidecars died with it,
//! since systemd kills the service's whole cgroup.

use std::io;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::Arc;
use std::thread;

use cumulusvpn_protocol as proto;
use cumulusvpn_tunnel::{spawn_repair_loop, TunnelManager};

use crate::{peer_linux, server};

pub fn main() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None => run_daemon(),
        Some("--cleanup") => cleanup(),
        Some("--ping") => ping(),
        Some("--version") => {
            println!("cumulusvpn-helper {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Some(other) => {
            eprintln!(
                "cumulusvpn-helper: unknown argument {other:?}\n\
                 usage: cumulusvpn-helper [--cleanup | --ping | --version]"
            );
            2
        }
    }
}

fn is_root() -> bool {
    // SAFETY: `geteuid` is a pure read of the calling process's effective uid.
    unsafe { libc::geteuid() == 0 }
}

fn run_daemon() -> i32 {
    if !is_root() {
        eprintln!(
            "cumulusvpn-helper must run as root; it is started by systemd \
             ({}), not by hand",
            proto::LINUX_UNIT
        );
        return 1;
    }

    // Before any thread exists, so every thread inherits the mask and the
    // signals are only ever delivered to the waiter below. (`std::process`
    // resets the mask for the commands we spawn.)
    let signals = block_termination_signals();

    let group = peer_linux::group_id(proto::LINUX_GROUP);
    if group.is_none() {
        eprintln!(
            "cumulusvpn-helper: the {} group does not exist, so only root can \
             use the helper. Reinstall the package, or: sudo groupadd --system {}",
            proto::LINUX_GROUP,
            proto::LINUX_GROUP
        );
    }

    let manager = Arc::new(TunnelManager::new());
    // A previous instance may have died mid-session: stale DNS, a kill switch
    // nobody will lift, an orphaned sidecar holding cvpn0. Clean all of it
    // before serving anyone.
    manager.recover_stale();

    let listener = match bind(group) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("cumulusvpn-helper: cannot bind {}: {e}", proto::SOCKET_PATH);
            return 1;
        }
    };

    spawn_repair_loop(Arc::clone(&manager));

    let stopping = Arc::clone(&manager);
    thread::spawn(move || wait_for_termination(signals, &stopping));

    let auth: server::Authenticator<UnixStream> =
        Arc::new(move |s: &UnixStream| peer_linux::authenticate(s, group));
    server::serve_forever(listener, manager, auth);
    0
}

/// Bind `/run/cumulusvpn/helper.sock`: `root:cumulusvpn` 0660 when the group
/// exists, root-only 0600 otherwise. systemd creates the directory
/// (`RuntimeDirectory=`); create it here too, root-only-writable, for a daemon
/// started outside systemd.
fn bind(group: Option<u32>) -> io::Result<std::os::unix::net::UnixListener> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

    let dir = Path::new(proto::SOCKET_PATH)
        .parent()
        .expect("socket path has a directory");
    if !dir.exists() {
        std::fs::DirBuilder::new()
            .mode(0o755)
            .recursive(true)
            .create(dir)?;
    }
    // Whoever created it, nobody but root may create files in it: that is what
    // makes the socket path trustworthy to the app.
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o755))?;
    std::os::unix::fs::chown(dir, Some(0), Some(0))?;

    let mode = if group.is_some() { 0o660 } else { 0o600 };
    server::bind_socket(proto::SOCKET_PATH, mode, group)
}

/// Block SIGTERM, SIGINT and SIGHUP in the calling thread (and so in every
/// thread spawned after), returning the set for [`wait_for_termination`].
fn block_termination_signals() -> libc::sigset_t {
    // SAFETY: `set` is initialised by `sigemptyset` before use, and the
    // signal numbers are valid.
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGTERM);
        libc::sigaddset(&mut set, libc::SIGINT);
        libc::sigaddset(&mut set, libc::SIGHUP);
        libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
        set
    }
}

/// Wait for SIGTERM / SIGINT, then disconnect and exit. Tearing down here, on an
/// ordinary thread, is what `sigwait` buys over a signal handler: the teardown
/// takes the manager lock and spawns `nft` / `ip` / `resolvectl`, none of which
/// is allowed in a handler. SIGHUP is accepted and ignored.
fn wait_for_termination(set: libc::sigset_t, manager: &TunnelManager) {
    loop {
        let mut sig: libc::c_int = 0;
        // SAFETY: `set` is a valid, initialised signal set; `sig` is writable.
        let rc = unsafe { libc::sigwait(&set, &mut sig) };
        if rc != 0 || sig == libc::SIGHUP {
            continue;
        }
        eprintln!("cumulusvpn-helper: stopping (signal {sig}), disconnecting first");
        // Only if something is up: a stop of an idle daemon must not touch the
        // firewall.
        manager.disconnect_if_active();
        let _ = std::fs::remove_file(proto::SOCKET_PATH);
        std::process::exit(0);
    }
}

/// `--cleanup`: the startup recovery, on its own. For package removal after
/// the service is stopped, and for an operator after a crash. Refuses while a
/// daemon answers, because then the "stale" state is a live session.
fn cleanup() -> i32 {
    if !is_root() {
        eprintln!("cumulusvpn-helper --cleanup must run as root");
        return 1;
    }
    if UnixStream::connect(proto::SOCKET_PATH).is_ok() {
        eprintln!(
            "cumulusvpn-helper: the helper is running; stop it first \
             (sudo systemctl stop {}) — it cleans up on stop",
            proto::LINUX_UNIT
        );
        return 1;
    }
    TunnelManager::new().recover_stale();
    println!("cumulusvpn-helper: stale tunnel state cleaned up");
    0
}

/// `--ping`: one `Ping` as this process. Exit 0 on a reply; otherwise print
/// why (not running, permission denied by the socket, refused by the peer
/// check) and exit 1.
fn ping() -> i32 {
    let mut stream = match UnixStream::connect(proto::SOCKET_PATH) {
        Ok(s) => s,
        Err(e) => {
            println!("cannot connect to {}: {e}", proto::SOCKET_PATH);
            return 1;
        }
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
    match server::ping(&mut stream) {
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
