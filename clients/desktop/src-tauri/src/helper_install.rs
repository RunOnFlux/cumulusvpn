//! Installing and approving the privileged helper.
//!
//! macOS 13 replaced the old "ask for the admin password and drop a binary into
//! `/Library`" dance (`SMJobBless`) with [`SMAppService`], where the daemon
//! ships *inside* the app bundle and the user approves it in **System Settings →
//! General → Login Items & Extensions**. That is why CumulusVPN no longer needs
//! to be launched with `sudo`: the app stays unprivileged forever, and the one
//! thing the user grants is permission for the helper to run.
//!
//! Registration is idempotent and cheap, so it runs on every launch: it is also
//! how the app recovers if the user removes the helper in Settings and later
//! wants it back.
//!
//! **Signing matters here.** `SMAppService` will only register a daemon whose
//! embedded plist and binary are signed by the same team as the app, and the
//! helper in turn refuses connections from anything that does not satisfy its
//! designated requirement (`helper/src/peer.rs`). An ad-hoc signed build will
//! fail to register — that is the system working, not a bug. Such a build can
//! still be run as root, which skips the helper entirely (see `backend.rs`).
//!
//! macOS only: the module is not compiled elsewhere. Linux and Windows run the
//! tunnel in-process and have nothing to register.

/// Where the helper's LaunchDaemon plist sits inside the bundle, relative to
/// `Contents/`. `SMAppService.daemon(plistName:)` takes just the filename and
/// looks in `Contents/Library/LaunchDaemons/`.
pub const PLIST_NAME: &str = "com.cumulusvpn.helper.plist";

/// Registration state of the helper, as the UI needs to talk about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelperState {
    /// Registered and running — the normal state.
    Enabled,
    /// Registered, but the user has not approved it in System Settings yet.
    RequiresApproval,
    /// Not registered (first run, or the user removed it).
    NotRegistered,
    /// macOS will not vouch for the daemon. The plist being absent is only one
    /// cause, and in practice the common one is an unsigned or ad-hoc signed
    /// build: `SMAppService` validates the daemon against the app's signature
    /// before it will admit the service exists.
    NotFound,
}

/// Read the helper's current registration state without trying to change it.
///
/// Separate from [`ensure_registered`] because the UI polls this every few
/// seconds while the user is over in System Settings, and a poll must not
/// re-invoke registration on every tick.
pub fn current_state() -> Result<HelperState, String> {
    imp::current_state()
}

/// Register the helper if it is not already enabled.
///
/// Returns the state we ended up in. A `RequiresApproval` result is not a
/// failure: it means macOS has queued the daemon and is waiting for the user,
/// which is exactly the one-time interaction this whole design is for.
pub fn ensure_registered() -> Result<HelperState, String> {
    imp::ensure_registered()
}

/// Open System Settings at the Login Items pane, so the app can hand the user
/// straight to the approval switch instead of describing where it lives.
pub fn open_approval_settings() {
    imp::open_approval_settings();
}

mod imp {
    use super::{HelperState, PLIST_NAME};

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Sel};
    use objc2::{msg_send, sel};
    use objc2_foundation::NSString;

    // Force the framework to be linked. Without it the class lookup below can
    // fail on a machine where nothing else has pulled ServiceManagement in.
    #[link(name = "ServiceManagement", kind = "framework")]
    extern "C" {}

    /// `SMAppServiceStatus` — see ServiceManagement/SMAppService.h.
    const STATUS_NOT_REGISTERED: isize = 0;
    const STATUS_ENABLED: isize = 1;
    const STATUS_REQUIRES_APPROVAL: isize = 2;
    const STATUS_NOT_FOUND: isize = 3;

    fn state_from(status: isize) -> HelperState {
        match status {
            STATUS_ENABLED => HelperState::Enabled,
            STATUS_REQUIRES_APPROVAL => HelperState::RequiresApproval,
            STATUS_NOT_FOUND => HelperState::NotFound,
            STATUS_NOT_REGISTERED => HelperState::NotRegistered,
            // A status this build does not know about. Treat as not-registered
            // so the app offers setup rather than claiming everything is fine.
            _ => HelperState::NotRegistered,
        }
    }

    /// Look up `SMAppService`, checking it answers the class method we need.
    ///
    /// The `responds_to` guards are not belt-and-braces: an unrecognised
    /// selector raises an Objective-C exception, and this crate is built with
    /// `panic = "abort"`, so it takes the whole app down rather than surfacing
    /// as an error. That is exactly how a wrong selector name here crashed
    /// 1.2.0 on launch. Probing first turns any future API drift — a renamed
    /// method, an OS that predates it — into a message on screen.
    fn service_class() -> Result<&'static AnyClass, String> {
        let class = AnyClass::get(c"SMAppService")
            .ok_or("ServiceManagement is unavailable (macOS 13 or later required)")?;
        // Class methods live on the metaclass.
        if !class.metaclass().responds_to(daemon_sel()) {
            return Err("SMAppService does not support daemonServiceWithPlistName:".into());
        }
        Ok(class)
    }

    /// The Objective-C selector, which is **not** the Swift name. Swift sees
    /// `SMAppService.daemon(plistName:)` via `NS_SWIFT_NAME`; the real selector
    /// is `daemonServiceWithPlistName:`.
    fn daemon_sel() -> Sel {
        sel!(daemonServiceWithPlistName:)
    }

    /// `SMAppService.daemon(plistName:)`.
    fn daemon() -> Result<Retained<AnyObject>, String> {
        let class = service_class()?;
        let name = NSString::from_str(PLIST_NAME);
        // SAFETY: the selector is verified above; it takes an NSString and
        // returns an autoreleased SMAppService, which objc2 retains for us.
        let obj: Option<Retained<AnyObject>> =
            unsafe { msg_send![class, daemonServiceWithPlistName: &*name] };
        obj.ok_or_else(|| format!("no daemon named {PLIST_NAME} in this bundle"))
    }

    /// Read `status`, refusing to send the message if the object does not
    /// answer it (see `service_class` for why that matters).
    fn status_of(service: &AnyObject) -> Result<HelperState, String> {
        if !service.class().responds_to(sel!(status)) {
            return Err("SMAppService does not expose status on this system".into());
        }
        // SAFETY: selector verified; `status` returns an NSInteger.
        let status: isize = unsafe { msg_send![service, status] };
        Ok(state_from(status))
    }

    pub fn current_state() -> Result<HelperState, String> {
        let service = daemon()?;
        status_of(&service)
    }

    pub fn ensure_registered() -> Result<HelperState, String> {
        let service = daemon()?;
        let state = status_of(&service)?;
        if state == HelperState::Enabled {
            return Ok(state);
        }
        if state == HelperState::NotFound {
            // Deliberately not an Err: this is a state the UI should render,
            // not a failure to swallow. Returning Err here made the frontend
            // fall back to "not registered", which describes the wrong problem.
            return Ok(state);
        }
        if !service.class().responds_to(sel!(registerAndReturnError:)) {
            return Err("SMAppService cannot register on this system".into());
        }

        // `registerAndReturnError:` is idempotent. When the user has not yet
        // approved, it succeeds and leaves the service in RequiresApproval.
        let mut error: *mut AnyObject = std::ptr::null_mut();
        // SAFETY: selector verified; `error` is a valid out-pointer.
        let ok: bool = unsafe { msg_send![&*service, registerAndReturnError: &mut error] };
        // Re-read rather than inferring: registration succeeding and the daemon
        // actually running are different things.
        let state = status_of(&service)?;
        if !ok && state != HelperState::RequiresApproval {
            return Err(describe_error(error));
        }
        Ok(state)
    }

    fn describe_error(error: *mut AnyObject) -> String {
        if error.is_null() {
            return "helper registration failed".into();
        }
        // SAFETY: on failure AppKit hands back an autoreleased NSError.
        let error_ref = unsafe { &*error };
        if !error_ref.class().responds_to(sel!(localizedDescription)) {
            return "helper registration failed".into();
        }
        // SAFETY: selector verified above.
        let description: Option<Retained<NSString>> =
            unsafe { msg_send![error_ref, localizedDescription] };
        match description {
            Some(d) => format!("helper registration failed: {d}"),
            None => "helper registration failed".into(),
        }
    }

    pub fn open_approval_settings() {
        // Apple ships an API for exactly this; it lands on the right pane and
        // survives Settings being reorganised, unlike a hardcoded URL scheme.
        if let Ok(class) = service_class() {
            if class
                .metaclass()
                .responds_to(sel!(openSystemSettingsLoginItems))
            {
                // SAFETY: selector verified; takes no arguments, returns void.
                unsafe { msg_send![class, openSystemSettingsLoginItems] }
                return;
            }
        }
        // Fall back to the deep link if the API is somehow unavailable.
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
            .status();
    }
}

/// The selectors this module sends, asserted to exist.
///
/// A wrong selector name is not a compile error in Rust — it is an
/// Objective-C exception at runtime, and with `panic = "abort"` that kills the
/// app on launch. Exactly that shipped in 1.2.0: the code used the *Swift*
/// name (`SMAppService.daemon(plistName:)` → `daemonWithPlistName:`) instead of
/// the real selector `daemonServiceWithPlistName:`. These tests are cheap and
/// would have caught it.
#[cfg(test)]
mod tests {
    use objc2::runtime::AnyClass;
    use objc2::sel;

    #[test]
    fn sm_app_service_is_available() {
        assert!(
            AnyClass::get(c"SMAppService").is_some(),
            "ServiceManagement not linked, or macOS older than 13"
        );
    }

    #[test]
    fn the_class_methods_we_send_exist() {
        let class = AnyClass::get(c"SMAppService").expect("SMAppService");
        // Class methods live on the metaclass.
        let meta = class.metaclass();
        assert!(
            meta.responds_to(sel!(daemonServiceWithPlistName:)),
            "the selector is daemonServiceWithPlistName:, NOT the Swift name daemonWithPlistName:"
        );
        assert!(meta.responds_to(sel!(openSystemSettingsLoginItems)));
    }

    #[test]
    fn the_instance_methods_we_send_exist() {
        let class = AnyClass::get(c"SMAppService").expect("SMAppService");
        assert!(class.responds_to(sel!(status)));
        assert!(class.responds_to(sel!(registerAndReturnError:)));
    }

    /// The Swift name must NOT be used. Pinned so nobody "fixes" the selector
    /// back to what the Swift API reads like.
    #[test]
    fn the_swift_name_is_not_a_selector() {
        let class = AnyClass::get(c"SMAppService").expect("SMAppService");
        assert!(
            !class.metaclass().responds_to(sel!(daemonWithPlistName:)),
            "if this ever passes, Apple added it and this test can go"
        );
    }
}
