//! One interface over the two places the tunnel can run.
//!
//! * **The helper daemon** (normal on every desktop OS): the app holds no
//!   privileges and sends every operation to `cumulusvpn-helper` through
//!   [`HelperClient`] — a LaunchDaemon on macOS (approved once in System
//!   Settings), a systemd service on Linux and a LocalSystem service on Windows
//!   (both installed and started by the packages). The daemon outlives the app,
//!   owns the repair loop, and keeps the tunnel up if the app is killed.
//! * **This process** (the elevated fallback), through the shared
//!   `cumulusvpn-tunnel` crate:
//!   * macOS, when launched as root. An unsigned or ad-hoc build cannot
//!     register the helper (`SMAppService` validates it against the app's
//!     signature), so `sudo` is the way to run one, as before the helper.
//!   * Linux and Windows, when the app is elevated (root / Administrator) and
//!     no helper answers at launch: an AppImage, which cannot install a system
//!     service, or a build whose service is missing. That is how both platforms
//!     worked before the daemon. An unelevated app never falls back; it shows
//!     the setup banner instead, so a missing service is never a silent failure.
//!
//!   Root already has every privilege the helper would provide, so the fallback
//!   grants nothing new. It runs the same repair loop on a thread here, and the
//!   same startup recovery the daemon runs.
//!
//! The Tauri commands only see [`TunnelBackend`]. Both arms take the same
//! `cumulusvpn-protocol` requests and return the same `TunnelStatus`.

use std::sync::Arc;

use serde::Serialize;

use cumulusvpn_protocol as proto;
use cumulusvpn_tunnel::{spawn_repair_loop, TunnelManager};

use crate::helper_client::HelperClient;
#[cfg(not(target_os = "macos"))]
use crate::helper_client::ProbeError;

/// Whether the tunnel can be used yet, as the UI needs to talk about it.
///
/// Serialised as the strings in the frontend's `HelperRegistration` union
/// (`src/lib/tauri.ts`). `Enabled`, `NotNeeded` and `Elevated` are the ready
/// states; the rest are setup steps with a banner explaining the fix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupState {
    /// macOS run as root: the tunnel runs in this process, nothing to set up.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NotNeeded,
    /// The helper is installed and answering, and serves this app.
    Enabled,
    /// macOS: registered, but the user has not approved it in System Settings.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    RequiresApproval,
    /// macOS: not registered (first run, or the user removed it).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NotRegistered,
    /// macOS will not vouch for the bundled helper: typically an unsigned or
    /// ad-hoc build. See `helper_install::HelperState::NotFound`.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NotFound,
    /// Linux / Windows: no helper answered at launch and the app is elevated, so
    /// the tunnel runs in this process (and stops when the app quits).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Elevated,
    /// Linux / Windows: the helper service is not installed (an AppImage, a
    /// bare binary, a damaged install).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    ServiceNotInstalled,
    /// Linux / Windows: installed, but not answering (stopped, disabled, or
    /// still starting).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    ServiceNotRunning,
    /// Linux / Windows: the helper answered and refused this app. Linux: the
    /// user is not in the `cumulusvpn` group yet (or has not logged in again
    /// since joining it). Windows: this is not the installed app.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    ServiceDenied,
}

/// Where this process sends tunnel operations. Chosen once at startup.
pub enum TunnelBackend {
    /// The privileged helper daemon.
    Helper(HelperClient),
    /// The tunnel engine running inside the app (the elevated fallback).
    InProcess(Arc<TunnelManager>),
}

impl TunnelBackend {
    /// Pick the backend for this platform and this launch.
    pub fn new() -> Self {
        #[cfg(target_os = "macos")]
        {
            if !running_as_root() {
                return TunnelBackend::Helper(HelperClient::new());
            }
            eprintln!(
                "CumulusVPN: running as root, so the tunnel runs in-process and the \
                 privileged helper is not used."
            );
        }
        #[cfg(not(target_os = "macos"))]
        {
            let helper = HelperClient::new();
            match helper.probe() {
                // The normal case: the service answers and serves us.
                Ok(()) => return TunnelBackend::Helper(helper),
                // Elevated and no service: run it ourselves, as before the
                // daemon existed.
                Err(e) if crate::platform::running_elevated() => eprintln!(
                    "CumulusVPN: the network helper is not available ({}), and the app \
                     is running elevated, so the tunnel runs in-process. It stops when \
                     the app quits.",
                    match &e {
                        ProbeError::Unreachable(m) | ProbeError::Denied(m) => m,
                    }
                ),
                // Unelevated: keep the helper client. The UI shows the setup
                // banner (`setup_state`) and notices when the service comes up.
                Err(_) => return TunnelBackend::Helper(helper),
            }
        }
        let manager = Self::start_manager();
        // A previous run killed mid-session can leave state behind. Clean it up
        // off the startup path (it may spawn PowerShell). It takes the manager
        // lock and skips if a session exists, so a fast Connect cannot be
        // undone by it. Only here, not in `in_process()`, which the tests
        // construct and which must not touch the machine.
        let recovering = Arc::clone(&manager);
        std::thread::spawn(move || {
            // macOS: DNS only (see `TunnelManager::recover_stale_dns`). Linux
            // and Windows: everything the daemon would clean at its own start.
            #[cfg(target_os = "macos")]
            recovering.recover_stale_dns();
            #[cfg(not(target_os = "macos"))]
            recovering.recover_stale();
        });
        TunnelBackend::InProcess(manager)
    }

    /// The in-process backend without the startup recovery, for tests.
    #[cfg(test)]
    fn in_process() -> Self {
        TunnelBackend::InProcess(Self::start_manager())
    }

    fn start_manager() -> Arc<TunnelManager> {
        let manager = Arc::new(TunnelManager::new());
        // The same loop the helper daemon runs. It keeps roam repair and the
        // dead-tunnel watchdog going while the window is hidden in the tray.
        spawn_repair_loop(Arc::clone(&manager));
        manager
    }

    /// True when operations go to the helper daemon.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn uses_helper(&self) -> bool {
        match self {
            TunnelBackend::Helper(_) => true,
            TunnelBackend::InProcess(_) => false,
        }
    }

    pub fn connect(&self, req: proto::ConnectRequest) -> Result<proto::TunnelStatus, String> {
        match self {
            TunnelBackend::Helper(helper) => helper.connect_tunnel(req),
            TunnelBackend::InProcess(manager) => {
                manager.connect_request(&req).map_err(|e| e.to_string())
            }
        }
    }

    pub fn connect_multihop(
        &self,
        req: proto::MultihopRequest,
    ) -> Result<proto::TunnelStatus, String> {
        match self {
            TunnelBackend::Helper(helper) => helper.connect_multihop(req),
            TunnelBackend::InProcess(manager) => manager
                .connect_multihop_request(&req)
                .map_err(|e| e.to_string()),
        }
    }

    pub fn disconnect(&self) -> Result<proto::TunnelStatus, String> {
        match self {
            TunnelBackend::Helper(helper) => helper.disconnect(),
            TunnelBackend::InProcess(manager) => manager.disconnect().map_err(|e| e.to_string()),
        }
    }

    /// Disconnect only if there is something to tear down. Used on quit.
    ///
    /// `disconnect` is unconditional by design: it lifts the kill switch and
    /// restores the platform firewall default whether or not we engaged
    /// anything (on Windows, `DefaultOutboundAction Allow` on every profile; on
    /// macOS, a reload of `/etc/pf.conf`). That is right for an explicit user
    /// Disconnect, but wrong on every quit of an app that never connected,
    /// where it would overwrite a firewall policy the user or an administrator
    /// set. `Down` means nothing of ours is engaged: every failed connect
    /// unwinds to `Error`, and `disconnect` is the only way back to `Down`.
    pub fn disconnect_if_active(&self) {
        match self.status() {
            Ok(s) if s.state == proto::TunnelState::Down => {}
            // Up, connecting, or failed with the kill switch possibly engaged.
            Ok(_) => {
                let _ = self.disconnect();
            }
            // The helper is unreachable, so a disconnect could not reach it
            // either.
            Err(_) => {}
        }
    }

    pub fn status(&self) -> Result<proto::TunnelStatus, String> {
        match self {
            TunnelBackend::Helper(helper) => helper.status(),
            TunnelBackend::InProcess(manager) => Ok(manager.status()),
        }
    }

    /// Is the tunnel engine reachable right now? Always, when it is in-process.
    pub fn is_available(&self) -> bool {
        match self {
            TunnelBackend::Helper(helper) => helper.is_available(),
            TunnelBackend::InProcess(_) => true,
        }
    }

    /// What the UI should say about setup, and whether Connect is usable.
    ///
    /// For the helper, a daemon that answers and serves us counts as `Enabled`
    /// whatever else is true. On macOS, in development the app is not a bundle,
    /// so registration reads `NotFound`, but a helper started by hand (see the
    /// README) is perfectly usable. Only when nothing usable answers does the
    /// platform's own state decide which setup step to show.
    pub fn setup_state(&self) -> Result<SetupState, String> {
        match self {
            #[cfg(target_os = "macos")]
            TunnelBackend::Helper(helper) => {
                use crate::helper_install::{current_state, HelperState};
                if helper.is_available() {
                    return Ok(SetupState::Enabled);
                }
                Ok(match current_state()? {
                    HelperState::Enabled => SetupState::Enabled,
                    HelperState::RequiresApproval => SetupState::RequiresApproval,
                    HelperState::NotRegistered => SetupState::NotRegistered,
                    HelperState::NotFound => SetupState::NotFound,
                })
            }
            #[cfg(not(target_os = "macos"))]
            TunnelBackend::Helper(helper) => Ok(setup_state_from_probe(
                helper.probe(),
                crate::platform::service_installed,
            )),
            #[cfg(target_os = "macos")]
            TunnelBackend::InProcess(_) => Ok(SetupState::NotNeeded),
            #[cfg(not(target_os = "macos"))]
            TunnelBackend::InProcess(_) => Ok(SetupState::Elevated),
        }
    }
}

/// Linux / Windows: the setup state from a probe of the helper. `installed` is
/// only consulted when nothing answered, to tell "install it" from "start it".
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn setup_state_from_probe(
    probe: Result<(), crate::helper_client::ProbeError>,
    installed: impl FnOnce() -> bool,
) -> SetupState {
    use crate::helper_client::ProbeError;
    match probe {
        Ok(()) => SetupState::Enabled,
        Err(ProbeError::Denied(_)) => SetupState::ServiceDenied,
        Err(ProbeError::Unreachable(_)) if installed() => SetupState::ServiceNotRunning,
        Err(ProbeError::Unreachable(_)) => SetupState::ServiceNotInstalled,
    }
}

impl Default for TunnelBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
fn running_as_root() -> bool {
    // SAFETY: `geteuid` is a pure read of the calling process's effective uid.
    unsafe { libc::geteuid() == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::helper_client::ProbeError;

    /// The frontend switches on these exact strings (`HelperRegistration` in
    /// `src/lib/tauri.ts`). A rename on either side would silently strand the
    /// UI in a setup banner, so pin the wire spelling.
    #[test]
    fn setup_states_serialise_as_the_frontend_expects() {
        let cases = [
            (SetupState::NotNeeded, "\"notNeeded\""),
            (SetupState::Enabled, "\"enabled\""),
            (SetupState::RequiresApproval, "\"requiresApproval\""),
            (SetupState::NotRegistered, "\"notRegistered\""),
            (SetupState::NotFound, "\"notFound\""),
            (SetupState::Elevated, "\"elevated\""),
            (SetupState::ServiceNotInstalled, "\"serviceNotInstalled\""),
            (SetupState::ServiceNotRunning, "\"serviceNotRunning\""),
            (SetupState::ServiceDenied, "\"serviceDenied\""),
        ];
        for (state, json) in cases {
            assert_eq!(serde_json::to_string(&state).unwrap(), json);
        }
    }

    /// Linux / Windows: every way the helper can fail to serve us maps to its
    /// own setup step, and a refusal is never mistaken for a missing service.
    #[test]
    fn a_probe_maps_to_the_right_setup_step() {
        let unreachable = || Err(ProbeError::Unreachable("no such file".into()));
        assert_eq!(
            setup_state_from_probe(Ok(()), || false),
            SetupState::Enabled
        );
        assert_eq!(
            setup_state_from_probe(unreachable(), || true),
            SetupState::ServiceNotRunning
        );
        assert_eq!(
            setup_state_from_probe(unreachable(), || false),
            SetupState::ServiceNotInstalled
        );
        assert_eq!(
            setup_state_from_probe(
                Err(ProbeError::Denied(proto::NOT_AUTHORISED.into())),
                || panic!("installation is irrelevant once the helper answered")
            ),
            SetupState::ServiceDenied
        );
    }

    /// The in-process arm needs nothing set up, reports a down tunnel before
    /// anything connects, and is always reachable. It is the elevated fallback
    /// on every OS, so assert it on every platform.
    #[test]
    fn the_in_process_backend_is_ready_and_down_at_launch() {
        let backend = TunnelBackend::in_process();
        assert!(!backend.uses_helper());
        assert!(backend.is_available());
        let expected = if cfg!(target_os = "macos") {
            SetupState::NotNeeded
        } else {
            SetupState::Elevated
        };
        assert_eq!(backend.setup_state(), Ok(expected));
        let status = backend.status().expect("in-process status never errors");
        assert_eq!(status.state, proto::TunnelState::Down);
        // Quitting an app that never connected is a no-op: nothing to tear
        // down, and the firewall is not touched.
        backend.disconnect_if_active();
        assert_eq!(
            backend.status().expect("status").state,
            proto::TunnelState::Down
        );
    }

    /// A helper that is not there reads as a setup step, never as ready, and
    /// Connect fails with a message rather than hanging. (Nothing listens on
    /// the helper's path on a CI runner or a developer machine without it.)
    #[cfg(target_os = "linux")]
    #[test]
    fn an_absent_linux_helper_is_a_setup_step() {
        if std::path::Path::new(proto::SOCKET_PATH).exists() {
            return; // a real helper is installed here; nothing to assert
        }
        let backend = TunnelBackend::Helper(HelperClient::new());
        assert!(!backend.is_available());
        let state = backend.setup_state().expect("state");
        assert!(
            matches!(
                state,
                SetupState::ServiceNotInstalled | SetupState::ServiceNotRunning
            ),
            "{state:?}"
        );
        let err = backend.status().expect_err("no helper");
        assert!(err.contains("not running"), "{err}");
    }
}
