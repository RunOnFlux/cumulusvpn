//! One interface over the two places the tunnel can run.
//!
//! * **macOS**: the root `cumulusvpn-helper` LaunchDaemon, reached over its
//!   socket ([`HelperClient`]). The app holds no privileges, and the user
//!   approves the helper once in System Settings.
//! * **Linux and Windows**: this process, through the shared
//!   `cumulusvpn-tunnel` crate, exactly as before the helper existed. The app
//!   must run elevated (root / Administrator); Windows refuses up front with an
//!   actionable message if it is not.
//! * **macOS, launched as root**: also in-process. An unsigned or ad-hoc build
//!   cannot register the helper (`SMAppService` validates it against the app's
//!   signature), so `sudo` is the way to run one. That is how macOS worked
//!   before the helper. Root already has every privilege the helper would
//!   provide, so this path grants nothing new.
//!
//! The Tauri commands only see [`TunnelBackend`]. Both arms take the same
//! `cumulusvpn-protocol` requests and return the same `TunnelStatus`. Recovery
//! does not depend on the webview either: the helper runs its own repair loop,
//! and the in-process arm starts the same loop on a thread here.

use std::sync::Arc;

use serde::Serialize;

use cumulusvpn_protocol as proto;
use cumulusvpn_tunnel::{spawn_repair_loop, TunnelManager};

#[cfg(target_os = "macos")]
use crate::helper_client::HelperClient;

/// Whether the tunnel can be used yet, as the UI needs to talk about it.
///
/// Serialised as the strings in the frontend's `HelperRegistration` union
/// (`src/lib/tauri.ts`). `NotNeeded` and `Enabled` are the two ready states;
/// the rest are helper setup steps, which only exist on macOS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupState {
    /// The tunnel runs in this process, so there is no helper to set up.
    NotNeeded,
    /// The helper is registered and running, or at least answering.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Enabled,
    /// Registered, but the user has not approved it in System Settings yet.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    RequiresApproval,
    /// Not registered (first run, or the user removed it).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NotRegistered,
    /// macOS will not vouch for the bundled helper: typically an unsigned or
    /// ad-hoc build. See `helper_install::HelperState::NotFound`.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NotFound,
}

/// Where this process sends tunnel operations. Chosen once at startup.
pub enum TunnelBackend {
    /// The macOS privileged helper daemon.
    #[cfg(target_os = "macos")]
    Helper(HelperClient),
    /// The tunnel engine running inside the app.
    InProcess(Arc<TunnelManager>),
}

impl TunnelBackend {
    /// Pick the backend for this platform and this launch.
    pub fn new() -> Self {
        #[cfg(target_os = "macos")]
        if !running_as_root() {
            return TunnelBackend::Helper(HelperClient::new());
        }
        #[cfg(target_os = "macos")]
        eprintln!(
            "CumulusVPN: running as root, so the tunnel runs in-process and the \
             privileged helper is not used."
        );
        Self::in_process()
    }

    fn in_process() -> Self {
        let manager = Arc::new(TunnelManager::new());
        // The same loop the helper daemon runs. It keeps roam repair and the
        // dead-tunnel watchdog going while the window is hidden in the tray.
        spawn_repair_loop(Arc::clone(&manager));
        TunnelBackend::InProcess(manager)
    }

    /// True when operations go to the helper daemon, i.e. there is something
    /// to register and approve.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn uses_helper(&self) -> bool {
        match self {
            #[cfg(target_os = "macos")]
            TunnelBackend::Helper(_) => true,
            TunnelBackend::InProcess(_) => false,
        }
    }

    pub fn connect(&self, req: proto::ConnectRequest) -> Result<proto::TunnelStatus, String> {
        match self {
            #[cfg(target_os = "macos")]
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
            #[cfg(target_os = "macos")]
            TunnelBackend::Helper(helper) => helper.connect_multihop(req),
            TunnelBackend::InProcess(manager) => manager
                .connect_multihop_request(&req)
                .map_err(|e| e.to_string()),
        }
    }

    pub fn disconnect(&self) -> Result<proto::TunnelStatus, String> {
        match self {
            #[cfg(target_os = "macos")]
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
            #[cfg(target_os = "macos")]
            TunnelBackend::Helper(helper) => helper.status(),
            TunnelBackend::InProcess(manager) => Ok(manager.status()),
        }
    }

    /// Is the tunnel engine reachable right now? Always, when it is in-process.
    pub fn is_available(&self) -> bool {
        match self {
            #[cfg(target_os = "macos")]
            TunnelBackend::Helper(helper) => helper.is_available(),
            TunnelBackend::InProcess(_) => true,
        }
    }

    /// What the UI should say about setup, and whether Connect is usable.
    ///
    /// For the helper, a daemon that answers counts as `Enabled` whatever
    /// `SMAppService` says. In development the app is not a bundle, so
    /// registration reads `NotFound`, but a helper started by hand (see the
    /// README) is perfectly usable. Only when nothing answers does the
    /// registration state decide which setup step to show.
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
            TunnelBackend::InProcess(_) => Ok(SetupState::NotNeeded),
        }
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
        ];
        for (state, json) in cases {
            assert_eq!(serde_json::to_string(&state).unwrap(), json);
        }
    }

    /// The in-process arm needs nothing set up, reports a down tunnel before
    /// anything connects, and is always reachable. This is the whole Linux and
    /// Windows story, so assert it on every platform.
    #[test]
    fn the_in_process_backend_is_ready_and_down_at_launch() {
        let backend = TunnelBackend::in_process();
        assert!(!backend.uses_helper());
        assert!(backend.is_available());
        assert_eq!(backend.setup_state(), Ok(SetupState::NotNeeded));
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
}
