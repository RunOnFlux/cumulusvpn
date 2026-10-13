//! Who is allowed to talk to the daemon.
//!
//! The socket is world-connectable, because file permissions cannot express the
//! rule we actually need. The helper is a system-wide LaunchDaemon; the app runs
//! as whichever human is logged in, and on a shared Mac that is several
//! different uids. A mode/owner check could only say "some user", which is no
//! restriction at all — every process that user runs, including a browser tab's
//! helper or a malicious download, would qualify.
//!
//! So identity is proven cryptographically instead: the connecting process must
//! satisfy a **designated requirement** pinning our bundle identifier and Team
//! ID. That is the same mechanism XPC uses, and it is what makes a root socket
//! with mode 0666 safe rather than a local privilege-escalation vector.
//!
//! **Audit token, not PID.** `LOCAL_PEERPID` is the obvious way to identify the
//! peer and the wrong one: pids are recycled, so between reading the pid and
//! checking its signature the process can exit and an attacker's process can
//! land on the same number. The kernel's audit token identifies the peer
//! unambiguously for the life of the connection, which closes that race.
//!
//! macOS only (the module is gated in `main.rs`). Linux and Windows have no
//! daemon: the app runs the tunnel in-process there, so there is no socket to
//! guard.

use std::os::unix::io::AsRawFd;
use std::os::unix::net::UnixStream;

/// The Apple Developer Team ID whose Developer ID certificate signs the shipped
/// desktop app. **This is the only place it is written down.**
/// `scripts/sign-macos.sh` reads it from here and refuses to sign with an
/// identity from any other team.
///
/// It must match the certificate that actually signs the release. If they
/// differ, the app cannot talk to its own daemon: every connection is refused
/// with "not authorised" and Connect fails. Change this and the signing identity
/// together.
///
/// `276MY32G8B` is the US company's Apple team, which holds the *Developer ID
/// Application* certificate that signs the desktop app. It is deliberately not
/// the iOS app's team (`DEVELOPMENT_TEAM` in
/// `clients/mobile/ios/CumulusVPN.xcodeproj`, still the UK team until that app
/// is transferred): the two platforms are signed independently, and only this
/// constant decides which team the helper trusts.
pub const APPLE_TEAM_ID: &str = "276MY32G8B";

/// The app's bundle identifier (`identifier` in `tauri.conf.json`).
pub const APP_BUNDLE_ID: &str = "com.cumulusvpn.desktop";

/// The identity the connecting app must prove, as a code-signing requirement.
///
/// `anchor apple generic` restricts to Apple-issued certificates (so a
/// self-signed binary claiming our identifier is refused), the identifier pins
/// the bundle, and `subject.OU` pins the Team ID — together, "our app, signed by
/// us".
fn requirement() -> String {
    format!(
        "anchor apple generic \
         and identifier \"{APP_BUNDLE_ID}\" \
         and certificate leaf[subject.OU] = \"{APPLE_TEAM_ID}\""
    )
}

/// Verify the peer on the other end of `stream`, or explain why it was refused.
///
/// Called once per connection before any request is read, so an unauthenticated
/// peer never reaches the dispatch layer.
pub fn authenticate(stream: &UnixStream) -> Result<(), String> {
    imp::authenticate(stream)
}

mod imp {
    use super::*;
    use std::ffi::c_void;
    use std::ptr;

    use core_foundation_sys::base::{CFRelease, CFTypeRef, OSStatus};
    use core_foundation_sys::data::{CFDataCreate, CFDataRef};
    use core_foundation_sys::dictionary::{
        kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks, CFDictionaryCreate,
        CFDictionaryRef,
    };
    use core_foundation_sys::string::{
        kCFStringEncodingUTF8, CFStringCreateWithBytes, CFStringRef,
    };

    /// `SOL_LOCAL` / `LOCAL_PEERTOKEN` from `<sys/un.h>` — the peer's audit
    /// token. Not exposed by the `libc` crate, so spelled out here.
    const SOL_LOCAL: libc::c_int = 0;
    const LOCAL_PEERTOKEN: libc::c_int = 0x006;

    /// `audit_token_t` is an opaque 8×u32 kernel token.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct AuditToken {
        val: [u32; 8],
    }

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        static kSecGuestAttributeAudit: CFStringRef;
        fn SecCodeCopyGuestWithAttributes(
            host: *const c_void,
            attributes: CFDictionaryRef,
            flags: u32,
            guest: *mut *const c_void,
        ) -> OSStatus;
        fn SecRequirementCreateWithString(
            text: CFStringRef,
            flags: u32,
            requirement: *mut *const c_void,
        ) -> OSStatus;
        fn SecCodeCheckValidity(
            code: *const c_void,
            flags: u32,
            requirement: *const c_void,
        ) -> OSStatus;
    }

    fn cf_string(s: &str) -> CFStringRef {
        // SAFETY: pointer/length describe `s`, which outlives the call; CF
        // copies the bytes.
        unsafe {
            CFStringCreateWithBytes(
                ptr::null_mut(),
                s.as_ptr(),
                s.len() as isize,
                kCFStringEncodingUTF8,
                false as u8,
            )
        }
    }

    /// The peer's audit token, straight from the kernel.
    fn peer_audit_token(stream: &UnixStream) -> Result<AuditToken, String> {
        let mut token = AuditToken { val: [0; 8] };
        let mut len = std::mem::size_of::<AuditToken>() as libc::socklen_t;
        // SAFETY: `token`/`len` are a correctly sized, writable pair for this
        // socket option; the fd is owned by `stream` and open for the call.
        let rc = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                SOL_LOCAL,
                LOCAL_PEERTOKEN,
                (&mut token as *mut AuditToken).cast::<c_void>(),
                &mut len,
            )
        };
        if rc != 0 {
            return Err(format!(
                "cannot read peer audit token: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(token)
    }

    pub fn authenticate(stream: &UnixStream) -> Result<(), String> {
        // In a debug build the app is ad-hoc signed and can never satisfy a Team
        // ID requirement, so development would be impossible. Release builds —
        // the only ones shipped — always verify.
        //
        // `cfg!` rather than `#[cfg]` deliberately: both branches are then
        // type-checked and compiled in every configuration, so the verification
        // path cannot rot unnoticed in the build everyone develops against. The
        // optimiser drops the dead branch in release.
        if cfg!(debug_assertions) {
            eprintln!(
                "cumulusvpn-helper: DEBUG BUILD — peer code-signature check skipped. \
                 Never ship this binary."
            );
            return Ok(());
        }
        let token = peer_audit_token(stream)?;
        verify_against_requirement(&token)
    }

    fn verify_against_requirement(token: &AuditToken) -> Result<(), String> {
        // SAFETY: every CF object created below is released on all paths; the
        // Security calls receive well-formed CF types and out-pointers.
        unsafe {
            let bytes = ptr::addr_of!(token.val).cast::<u8>();
            let data: CFDataRef = CFDataCreate(
                ptr::null_mut(),
                bytes,
                std::mem::size_of::<AuditToken>() as isize,
            );
            if data.is_null() {
                return Err("cannot wrap audit token".into());
            }

            let keys = [kSecGuestAttributeAudit.cast::<c_void>()];
            let values = [data.cast::<c_void>()];
            let attrs: CFDictionaryRef = CFDictionaryCreate(
                ptr::null_mut(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            CFRelease(data.cast::<CFTypeRef>() as CFTypeRef);
            if attrs.is_null() {
                return Err("cannot build guest attributes".into());
            }

            let mut code: *const c_void = ptr::null();
            let status = SecCodeCopyGuestWithAttributes(ptr::null(), attrs, 0, &mut code);
            CFRelease(attrs.cast::<CFTypeRef>() as CFTypeRef);
            if status != 0 || code.is_null() {
                return Err(format!("peer is not identifiable code (OSStatus {status})"));
            }

            let req_text = cf_string(&super::requirement());
            let mut requirement: *const c_void = ptr::null();
            let status = SecRequirementCreateWithString(req_text, 0, &mut requirement);
            CFRelease(req_text.cast::<CFTypeRef>() as CFTypeRef);
            if status != 0 || requirement.is_null() {
                CFRelease(code.cast::<CFTypeRef>() as CFTypeRef);
                return Err(format!("malformed requirement (OSStatus {status})"));
            }

            let status = SecCodeCheckValidity(code, 0, requirement);
            CFRelease(requirement.cast::<CFTypeRef>() as CFTypeRef);
            CFRelease(code.cast::<CFTypeRef>() as CFTypeRef);
            if status != 0 {
                return Err(format!(
                    "peer does not satisfy the designated requirement (OSStatus {status})"
                ));
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The requirement pins exactly our bundle and our team, and nothing else
    /// slipped into the string.
    #[test]
    fn the_requirement_pins_our_bundle_and_team() {
        assert_eq!(
            requirement(),
            format!(
                "anchor apple generic and identifier \"{APP_BUNDLE_ID}\" \
                 and certificate leaf[subject.OU] = \"{APPLE_TEAM_ID}\""
            )
        );
        assert_eq!(APP_BUNDLE_ID, "com.cumulusvpn.desktop");
    }

    /// A Team ID is ten uppercase alphanumerics. A typo here is not a compile
    /// error; it is a release build that refuses its own app.
    #[test]
    fn the_team_id_is_well_formed() {
        assert_eq!(APPLE_TEAM_ID.len(), 10);
        assert!(APPLE_TEAM_ID
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()));
    }

    /// The requirement must compile. A malformed one makes every connection
    /// fail with "malformed requirement", and that only shows up at runtime on
    /// a signed build, so check it with the same Security call the daemon uses.
    #[test]
    fn the_requirement_parses() {
        use core_foundation_sys::base::{CFRelease, CFTypeRef, OSStatus};
        use core_foundation_sys::string::{
            kCFStringEncodingUTF8, CFStringCreateWithBytes, CFStringRef,
        };
        use std::ffi::c_void;
        use std::ptr;

        #[link(name = "Security", kind = "framework")]
        extern "C" {
            fn SecRequirementCreateWithString(
                text: CFStringRef,
                flags: u32,
                requirement: *mut *const c_void,
            ) -> OSStatus;
        }

        let text = requirement();
        // SAFETY: the pointer/length describe `text`, which outlives the call;
        // every CF object created here is released before returning.
        unsafe {
            let cf = CFStringCreateWithBytes(
                ptr::null_mut(),
                text.as_ptr(),
                text.len() as isize,
                kCFStringEncodingUTF8,
                false as u8,
            );
            assert!(!cf.is_null());
            let mut req: *const c_void = ptr::null();
            let status = SecRequirementCreateWithString(cf, 0, &mut req);
            CFRelease(cf as CFTypeRef);
            assert_eq!(status, 0, "requirement does not parse: {text}");
            assert!(!req.is_null());
            CFRelease(req as CFTypeRef);
        }
    }
}
