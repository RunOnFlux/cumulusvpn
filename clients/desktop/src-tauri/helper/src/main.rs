//! CumulusVPN privileged helper — the macOS root daemon.
//!
//! Everything that needs root lives here: the `pf` kill switch, route table
//! edits, creating the `utun` device and spawning `wireguard-go`. The app
//! itself runs unprivileged and drives this over a Unix socket, so the user
//! never sees a password prompt beyond the one-time approval that installs the
//! daemon. The tunnel itself is the shared `cumulusvpn-tunnel` crate; this
//! binary is the socket server and the privilege boundary around it.
//!
//! **macOS only.** On Linux and Windows the app runs the same tunnel crate
//! in-process (see `src-tauri/src/backend.rs`), so there is no daemon to
//! install, and this binary only explains that and exits. It still compiles
//! there so the workspace builds on every desktop OS, and the socket server's
//! tests run on Linux CI.
//!
//! **The socket is the privilege boundary.** Anything that can talk to it can
//! ask a root process to rewrite the firewall and the routing table, so the
//! socket is world-connectable *only* because every peer is authenticated by
//! code signature before a single request is honoured — see [`peer`]. Get that
//! wrong and this is a local privilege-escalation vector rather than a
//! convenience.
//!
//! **The daemon owns recovery.** The roam repair and dead-tunnel watchdog run on
//! a thread here, not in the app: a tunnel must keep healing across a Wi-Fi
//! change whether the app is in the foreground, hidden in the tray, or not
//! running at all.

#[cfg(target_os = "macos")]
mod peer;
#[cfg(unix)]
mod server;

#[cfg(target_os = "macos")]
fn main() {
    use std::sync::Arc;

    use cumulusvpn_protocol as proto;
    use cumulusvpn_tunnel::{spawn_repair_loop, TunnelManager};

    // A helper that is not root cannot do its job, and every failure downstream
    // would be a confusing permission error instead of this one line.
    if !is_root() {
        eprintln!("cumulusvpn-helper must run as root (it is a LaunchDaemon, not a user agent)");
        std::process::exit(1);
    }

    let manager = Arc::new(TunnelManager::new());
    spawn_repair_loop(Arc::clone(&manager));

    let listener = match server::bind_socket(proto::SOCKET_PATH) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("cumulusvpn-helper: cannot bind {}: {e}", proto::SOCKET_PATH);
            std::process::exit(1);
        }
    };

    server::serve_forever(listener, manager, peer::authenticate);
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!(
        "cumulusvpn-helper is the macOS privileged helper. On Linux and Windows \
         the CumulusVPN app runs the tunnel in-process and needs no helper."
    );
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn is_root() -> bool {
    // SAFETY: `geteuid` is a pure read of the calling process's effective uid.
    unsafe { libc::geteuid() == 0 }
}
