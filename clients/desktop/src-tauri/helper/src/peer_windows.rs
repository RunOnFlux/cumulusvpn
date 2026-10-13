//! Who is allowed to talk to the Windows service.
//!
//! Three layers, outermost first:
//!
//! 1. **The pipe's security descriptor** ([`PIPE_SDDL`]) admits SYSTEM,
//!    Administrators and interactive users, and nothing that cannot write to a
//!    medium-integrity object. That is the boundary: "people logged on to this
//!    machine may use the VPN", which is also what an elevated in-process app
//!    used to require an administrator for.
//! 2. **An elevated administrator is served as is.** Its token already holds
//!    every privilege the service has, so checking further would protect
//!    nothing (this is the `--ping` an operator or CI runs from an elevated
//!    prompt).
//! 3. **Anyone else must be the installed app.** The client's process id comes
//!    from the kernel (`GetNamedPipeClientProcessId`), and its image path must
//!    be `cumulusvpn-desktop.exe` in this service's own directory — the install
//!    directory under Program Files, writable only by administrators, which is
//!    why the NSIS installer is per-machine. Like the Linux executable check,
//!    this keeps casual misuse out but is defence in depth, not a boundary: a
//!    user can inject code into their own processes, and Windows has no
//!    audit-token equivalent that closes the pid-reuse window completely. Every
//!    request is shape-checked before it touches anything
//!    (`cumulusvpn_tunnel::validate`).
//!
//! **Authenticode is a prepared seam.** Once the Windows build is code-signed,
//! set [`REQUIRE_AUTHENTICODE`] and implement [`signature_policy`]
//! (`WinVerifyTrust` on the image, then pin the signer's subject). Until then
//! the path check stands alone; flipping the constant without the
//! implementation refuses every unelevated peer, so it cannot silently pass.
//!
//! The policy values and path comparison are pure and compiled on every host,
//! so CI tests them; only [`authenticate`] is Windows-only.

use cumulusvpn_protocol as proto;

/// The pipe's security descriptor, in SDDL:
///
/// * `D:P` — a protected DACL (nothing inherited);
/// * `(A;;GA;;;SY)`, `(A;;GA;;;BA)` — full control for SYSTEM and the
///   Administrators group;
/// * `(A;;0x12008b;;;IU)` — interactive users get exactly
///   [`proto::PIPE_CLIENT_ACCESS`]: `FILE_GENERIC_READ | FILE_WRITE_DATA`.
///   Not `FILE_CREATE_PIPE_INSTANCE` (0x4), which would let them add server
///   instances of the pipe.
#[cfg_attr(not(windows), allow(dead_code))]
pub const PIPE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x12008b;;;IU)";

/// [`PIPE_SDDL`] with the Administrators group as explicit owner, for
/// `--console` runs from an elevated prompt. The service (SYSTEM) gets SYSTEM as
/// the pipe's owner by default, but an administrator's objects are owned by
/// their own user SID, which the app rejects: it only talks to a pipe owned by
/// SYSTEM or Administrators, so that an unprivileged process squatting on the
/// name cannot pose as the helper.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn console_sddl() -> String {
    format!("O:BA{PIPE_SDDL}")
}

/// Whether an unelevated peer's image must also carry a valid Authenticode
/// signature from our publisher. Off until the Windows build is signed.
#[cfg_attr(not(windows), allow(dead_code))]
pub const REQUIRE_AUTHENTICODE: bool = false;

/// A Windows path in a form two spellings of the same file compare equal in:
/// no `\\?\` verbatim prefix, backslashes, lower case (NTFS is
/// case-insensitive for our ASCII install paths).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn normalize_path(path: &str) -> String {
    let path = path.strip_prefix(r"\\?\").unwrap_or(path);
    path.replace('/', "\\").to_lowercase()
}

/// The app image this service serves: `cumulusvpn-desktop.exe` next to the
/// service's own executable.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn expected_app(helper_exe: &std::path::Path) -> Option<std::path::PathBuf> {
    Some(
        helper_exe
            .parent()?
            .join(format!("{}.exe", proto::APP_BINARY_NAME)),
    )
}

/// What the service requires of a signature, beyond the path. See
/// [`REQUIRE_AUTHENTICODE`].
#[cfg_attr(not(windows), allow(dead_code))]
pub fn signature_policy(image: &str) -> Result<(), String> {
    if !REQUIRE_AUTHENTICODE {
        return Ok(());
    }
    Err(format!(
        "{image}: Authenticode verification is required but not implemented"
    ))
}

#[cfg(windows)]
pub use imp::authenticate;

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::c_void;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    use crate::pipe::Pipe;

    struct Owned(HANDLE);

    impl Drop for Owned {
        fn drop(&mut self) {
            // SAFETY: a handle we opened, closed once.
            unsafe { CloseHandle(self.0) };
        }
    }

    fn last_error() -> String {
        std::io::Error::last_os_error().to_string()
    }

    fn is_elevated(process: HANDLE) -> bool {
        let mut token: HANDLE = ptr::null_mut();
        // SAFETY: valid process handle, valid out-pointer.
        if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
            return false;
        }
        let token = Owned(token);
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        // SAFETY: `elevation` is a correctly sized, writable TOKEN_ELEVATION.
        let ok = unsafe {
            GetTokenInformation(
                token.0,
                TokenElevation,
                (&mut elevation as *mut TOKEN_ELEVATION).cast::<c_void>(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut len,
            )
        };
        ok != 0 && elevation.TokenIsElevated != 0
    }

    fn image_path(process: HANDLE) -> Result<String, String> {
        let mut buf = vec![0u16; 32 * 1024];
        let mut len = buf.len() as u32;
        // SAFETY: `buf` holds `len` UTF-16 units; `len` is updated to the
        // length written (without the terminator).
        let ok = unsafe {
            QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len)
        };
        if ok == 0 {
            return Err(format!(
                "cannot read the client's image path: {}",
                last_error()
            ));
        }
        Ok(String::from_utf16_lossy(&buf[..len as usize]))
    }

    /// Canonical, comparable form of a path that exists; the raw text if it
    /// does not (then it simply will not match).
    fn comparable(path: &std::path::Path) -> String {
        let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        normalize_path(&real.to_string_lossy())
    }

    pub fn authenticate(pipe: &Pipe) -> Result<(), String> {
        let mut pid = 0u32;
        // SAFETY: a connected server pipe handle and a valid out-pointer.
        if unsafe { GetNamedPipeClientProcessId(pipe.handle(), &mut pid) } == 0 {
            return Err(format!("cannot identify the client: {}", last_error()));
        }
        // SAFETY: plain OpenProcess; the handle is closed by `Owned`.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return Err(format!(
                "cannot open client process {pid}: {}",
                last_error()
            ));
        }
        let process = Owned(process);

        if is_elevated(process.0) {
            return Ok(());
        }

        let image = image_path(process.0)?;
        let helper = std::env::current_exe()
            .map_err(|e| format!("cannot locate this service's executable: {e}"))?;
        let expected = expected_app(&helper).ok_or("the service has no install directory")?;
        if comparable(std::path::Path::new(&image)) != comparable(&expected) {
            return Err(format!(
                "pid {pid} runs {image}, not the installed CumulusVPN app ({})",
                expected.display()
            ));
        }
        signature_policy(&image)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// The descriptor grants interactive users exactly what the app asks for,
    /// and never the right to create server instances of the pipe.
    #[test]
    fn interactive_users_get_exactly_the_client_access() {
        let ace = format!("(A;;{:#x};;;IU)", proto::PIPE_CLIENT_ACCESS);
        assert!(PIPE_SDDL.contains(&ace), "{PIPE_SDDL} lacks {ace}");
        const FILE_CREATE_PIPE_INSTANCE: u32 = 0x4;
        const FILE_GENERIC_READ: u32 = 0x0012_0089;
        const FILE_WRITE_DATA: u32 = 0x2;
        assert_eq!(
            proto::PIPE_CLIENT_ACCESS,
            FILE_GENERIC_READ | FILE_WRITE_DATA
        );
        assert_eq!(proto::PIPE_CLIENT_ACCESS & FILE_CREATE_PIPE_INSTANCE, 0);
        // Only SYSTEM and Administrators get anything more, and the DACL is
        // protected from inheritance.
        assert!(PIPE_SDDL.starts_with("D:P"));
        assert_eq!(PIPE_SDDL.matches("(A;;GA;;;").count(), 2);
        assert!(PIPE_SDDL.contains("(A;;GA;;;SY)") && PIPE_SDDL.contains("(A;;GA;;;BA)"));
        assert!(!PIPE_SDDL.contains(";;;WD)") && !PIPE_SDDL.contains(";;;AU)"));
    }

    #[test]
    fn the_console_descriptor_only_adds_an_administrators_owner() {
        assert_eq!(console_sddl(), format!("O:BA{PIPE_SDDL}"));
    }

    #[test]
    fn paths_compare_regardless_of_spelling() {
        let a = normalize_path(r"\\?\C:\Program Files\CumulusVPN\cumulusvpn-desktop.exe");
        let b = normalize_path(r"c:\program files\cumulusvpn\CUMULUSVPN-DESKTOP.EXE");
        assert_eq!(a, b);
        assert_ne!(
            normalize_path(r"C:\Users\me\AppData\Local\Temp\cumulusvpn-desktop.exe"),
            b
        );
    }

    #[test]
    fn the_expected_app_sits_next_to_the_service() {
        let helper = Path::new("C:/Program Files/CumulusVPN/cumulusvpn-helper.exe");
        let app = expected_app(helper).expect("has a parent");
        assert!(app.ends_with("cumulusvpn-desktop.exe"));
        assert_eq!(app.parent(), helper.parent());
    }

    /// Unsigned builds are what ships today, so the seam must let the
    /// installed app through. (With `REQUIRE_AUTHENTICODE` set and no
    /// implementation it refuses everyone: fail-closed by construction.)
    #[test]
    fn the_signature_seam_does_not_refuse_unsigned_builds_yet() {
        assert!(signature_policy("C:/x.exe").is_ok());
    }
}
