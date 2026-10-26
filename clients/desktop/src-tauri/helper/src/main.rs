//! CumulusVPN privileged helper — the daemon that owns the tunnel.
//!
//! Everything that needs root or Administrator lives here: the kill switch
//! (pf / nftables / Windows Firewall), route table edits, creating the tun
//! device, spawning `wireguard-go`, and the system resolver. The app itself runs
//! unprivileged and drives this over local IPC, so using the VPN never needs a
//! password prompt beyond installing the daemon. The tunnel itself is the shared
//! `cumulusvpn-tunnel` crate; this binary is the server and the privilege
//! boundary around it. One binary, one protocol, three platform transports:
//!
//! | OS | Runs as | Listens on | Peer authentication |
//! |---|---|---|---|
//! | macOS | LaunchDaemon (`SMAppService`) | Unix socket, 0666 | code signature: our bundle id + Team ID ([`peer`]) |
//! | Linux | systemd service | Unix socket, `root:cumulusvpn` 0660 | group membership + `SO_PEERCRED` + executable ([`peer_linux`]) |
//! | Windows | LocalSystem service | named pipe, interactive users | elevated, or the installed app image ([`peer_windows`]) |
//!
//! **The IPC endpoint is the privilege boundary.** Anything that can talk to it
//! can ask a privileged process to rewrite the firewall and the routing table,
//! so every peer is authenticated before a single request is honoured, and
//! every request is shape-checked before it touches anything. Get that wrong
//! and this is a local privilege-escalation vector rather than a convenience.
//!
//! **The daemon owns recovery.** The roam repair and dead-tunnel watchdog run on
//! a thread here, not in the app: a tunnel must keep healing across a Wi-Fi
//! change whether the app is in the foreground, hidden in the tray, or not
//! running at all. On Linux and Windows the daemon also cleans up after a
//! previous instance that died mid-session before it serves anyone.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(any(windows, target_os = "macos"))]
mod logfile;
#[cfg(target_os = "macos")]
mod peer;
// Pure parts are compiled everywhere so the policy is tested on every CI host.
mod peer_linux;
mod peer_windows;
#[cfg(windows)]
mod pipe;
mod server;
#[cfg(windows)]
mod windows;

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

    // launchd discards a daemon's stderr unless told otherwise; ours goes to a
    // capped log in the system log directory, root-writable only.
    let log_dir = std::path::Path::new(LOG_DIR);
    if std::fs::create_dir_all(log_dir).is_ok() {
        logfile::install(&log_dir.join("helper.log"));
    }
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    eprintln!(
        "cumulusvpn-helper: service starting at {secs} (pid {})",
        std::process::id()
    );

    let manager = Arc::new(TunnelManager::new());
    // A previous instance may have died with the system DNS still pointed at
    // the tunnel (launchd restarts us within seconds). Its backups live in the
    // dynamic store, so put them back before serving anyone.
    manager.recover_stale_dns();
    spawn_repair_loop(Arc::clone(&manager));

    // World-connectable on purpose; see `server::bind_socket` and `peer`.
    let listener = match server::bind_socket(proto::SOCKET_PATH, 0o666, None) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("cumulusvpn-helper: cannot bind {}: {e}", proto::SOCKET_PATH);
            std::process::exit(1);
        }
    };

    let auth: server::Authenticator<std::os::unix::net::UnixStream> = Arc::new(peer::authenticate);
    server::serve_forever(listener, manager, auth);
}

#[cfg(target_os = "linux")]
fn main() {
    std::process::exit(linux::main());
}

#[cfg(windows)]
fn main() {
    std::process::exit(windows::main());
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn main() {
    eprintln!("cumulusvpn-helper supports macOS, Linux and Windows only");
    std::process::exit(1);
}

/// The macOS daemon's log directory: the system log location, root-writable.
#[cfg(target_os = "macos")]
const LOG_DIR: &str = "/Library/Logs/CumulusVPN";

#[cfg(target_os = "macos")]
fn is_root() -> bool {
    // SAFETY: `geteuid` is a pure read of the calling process's effective uid.
    unsafe { libc::geteuid() == 0 }
}

/// Packaging guards: the Linux unit and package metadata must agree with the
/// constants the daemon and the app use, or the daemon starts somewhere the app
/// never looks. Plain text checks, so they run on every CI host.
#[cfg(test)]
mod packaging_tests {
    use std::path::Path;

    use cumulusvpn_protocol as proto;

    /// Line endings normalised: a Windows checkout may have CRLF.
    fn read(rel: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(rel);
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .replace("\r\n", "\n")
    }

    const LINUX_SOCKET: &str = "/run/cumulusvpn/helper.sock";

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn the_linux_socket_constant_is_the_one_documented() {
        assert_eq!(proto::SOCKET_PATH, LINUX_SOCKET);
    }

    #[test]
    fn the_unit_runs_the_installed_helper_in_the_socket_directory() {
        let unit = read("linux/cumulusvpn-helper.service");
        assert!(
            unit.contains("\nExecStart=/usr/bin/cumulusvpn-helper\n"),
            "{unit}"
        );
        let dir = Path::new(LINUX_SOCKET)
            .parent()
            .and_then(Path::file_name)
            .and_then(|n| n.to_str())
            .expect("socket dir");
        assert!(
            unit.contains(&format!("\nRuntimeDirectory={dir}\n")),
            "{unit}"
        );
        assert!(unit.contains("\nRuntimeDirectoryMode=0755\n"), "{unit}");
        // SIGTERM to the daemon only, so it can disconnect before systemd
        // kills its sidecars.
        assert!(unit.contains("\nKillMode=mixed\n"), "{unit}");
        assert!(unit.contains("\nRestart=always\n"), "{unit}");
        assert!(unit.contains("\nWantedBy=multi-user.target\n"), "{unit}");
    }

    #[test]
    fn the_packages_ship_the_helper_and_the_unit_where_the_scripts_expect_them() {
        let conf = read("tauri.linux.conf.json");
        let unit_path = format!("/usr/lib/systemd/system/{}", proto::LINUX_UNIT);
        for needle in [
            "\"/usr/bin/cumulusvpn-helper\": \"helper/build/cumulusvpn-helper\"",
            &format!("\"{unit_path}\": \"linux/cumulusvpn-helper.service\""),
        ] {
            assert_eq!(
                conf.matches(needle).count(),
                2,
                "deb and rpm both need {needle}"
            );
        }
        for script in [
            "linux/deb-postinst.sh",
            "linux/rpm-post.sh",
            "linux/deb-prerm.sh",
            "linux/rpm-preun.sh",
        ] {
            let text = read(script);
            assert!(
                text.contains(proto::LINUX_UNIT),
                "{script} names another unit"
            );
        }
        for script in ["linux/deb-postinst.sh", "linux/rpm-post.sh"] {
            let text = read(script);
            assert!(
                text.contains(&format!("GROUP={}", proto::LINUX_GROUP)),
                "{script}"
            );
        }
    }

    #[test]
    fn the_windows_installers_register_the_service_the_app_looks_for() {
        let nsh = read("windows/hooks.nsh");
        assert!(
            nsh.contains(&format!(
                "!define CVPN_SERVICE \"{}\"",
                proto::WINDOWS_SERVICE_NAME
            )),
            "{nsh}"
        );
        let wxs = read("windows/helper-service.wxs");
        assert_eq!(
            wxs.matches(&format!("Name=\"{}\"", proto::WINDOWS_SERVICE_NAME))
                .count(),
            2,
            "ServiceInstall and ServiceControl must both name the service"
        );
        let conf = read("tauri.windows.conf.json");
        assert!(conf.contains("\"installMode\": \"perMachine\""), "{conf}");
        assert!(
            conf.contains("\"installerHooks\": \"windows/hooks.nsh\""),
            "{conf}"
        );
        assert!(conf.contains("\"windows/helper-service.wxs\""), "{conf}");
        assert!(conf.contains("\"CumulusVpnHelperService\""), "{conf}");
    }
}
