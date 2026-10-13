//! Linux and Windows: what the setup state needs to know besides whether the
//! helper answers — is its service installed at all, and is this app elevated
//! (and so able to run the tunnel in-process when no helper answers)?
//!
//! Not compiled on macOS, where `SMAppService` answers the first question and
//! the second is a plain euid check in `backend.rs`.

#[cfg(target_os = "linux")]
mod imp {
    use std::path::Path;

    use cumulusvpn_protocol as proto;

    /// Where packages and administrators put system units.
    const UNIT_DIRS: [&str; 3] = [
        "/usr/lib/systemd/system",
        "/lib/systemd/system",
        "/etc/systemd/system",
    ];

    /// The .deb / .rpm install the unit; an AppImage, a tarball or a
    /// development build does not.
    pub fn service_installed() -> bool {
        UNIT_DIRS
            .iter()
            .any(|dir| Path::new(dir).join(proto::LINUX_UNIT).exists())
    }

    pub fn running_elevated() -> bool {
        // SAFETY: `geteuid` is a pure read of the calling process's effective uid.
        unsafe { libc::geteuid() == 0 }
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Services::{
        CloseServiceHandle, OpenSCManagerW, OpenServiceW, SC_MANAGER_CONNECT, SERVICE_QUERY_STATUS,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    use cumulusvpn_protocol as proto;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Whether the installer registered the service. Any user may connect to
    /// the Service Control Manager and query a service's status.
    pub fn service_installed() -> bool {
        // SAFETY: plain SCM calls; every handle opened here is closed here.
        unsafe {
            let scm = OpenSCManagerW(ptr::null(), ptr::null(), SC_MANAGER_CONNECT);
            if scm.is_null() {
                return false;
            }
            let name = wide(proto::WINDOWS_SERVICE_NAME);
            let service = OpenServiceW(scm, name.as_ptr(), SERVICE_QUERY_STATUS);
            let installed = !service.is_null();
            if installed {
                CloseServiceHandle(service);
            }
            CloseServiceHandle(scm);
            installed
        }
    }

    /// Whether this process holds an elevated (administrator) token.
    pub fn running_elevated() -> bool {
        let mut token: HANDLE = ptr::null_mut();
        // SAFETY: the pseudo-handle of the current process, a valid out-pointer.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        // SAFETY: `elevation` is a correctly sized, writable TOKEN_ELEVATION.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                (&mut elevation as *mut TOKEN_ELEVATION).cast::<c_void>(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut len,
            )
        };
        // SAFETY: the token handle we opened above.
        unsafe { CloseHandle(token) };
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(any(target_os = "linux", windows))]
pub use imp::{running_elevated, service_installed};

/// Other Unixes have no packaged service and no supported in-process path.
#[cfg(not(any(target_os = "linux", windows)))]
pub fn service_installed() -> bool {
    false
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn running_elevated() -> bool {
    false
}
