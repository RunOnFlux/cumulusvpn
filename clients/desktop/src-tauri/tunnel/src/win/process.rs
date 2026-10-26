//! The process questions the tunnel asks on Windows, answered natively: does
//! this process run as LocalSystem, and which `wireguard-go.exe` processes are
//! ours.

use std::path::Path;
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::{
    GetTokenInformation, IsWellKnownSid, TokenUser, WinLocalSystemSid, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, TerminateProcess,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};

/// Whether this process runs as LocalSystem: the identity the tunnel needs on
/// Windows, because wireguard-go creates its UAPI pipe owned by SYSTEM
/// (`O:SY`, amneziawg-go `ipc/uapi_windows.go`), which only a SYSTEM process
/// may do. The helper service runs as LocalSystem.
pub(crate) fn is_local_system() -> bool {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: the pseudo-handle of this process and a valid out-pointer.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return false;
    }
    let token = Handle(token);
    // TOKEN_USER is followed by the SID it points into; 256 bytes holds any.
    let mut buf = [0u64; 32];
    let mut len = 0u32;
    // SAFETY: an open token, an aligned buffer and its size in bytes.
    let ok = unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            buf.as_mut_ptr().cast(),
            std::mem::size_of_val(&buf) as u32,
            &mut len,
        )
    };
    if ok == 0 {
        return false;
    }
    // SAFETY: GetTokenInformation filled the buffer with a TOKEN_USER.
    let user = unsafe { &*(buf.as_ptr() as *const TOKEN_USER) };
    // SAFETY: the SID pointer refers into `buf`, which is alive here.
    unsafe { IsWellKnownSid(user.User.Sid, WinLocalSystemSid) != 0 }
}

struct Handle(HANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: an open handle, closed once.
        unsafe { CloseHandle(self.0) };
    }
}

fn image_path(process: &Handle) -> Option<String> {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: a process handle opened with QUERY_LIMITED_INFORMATION, a buffer
    // and its length in characters.
    let ok = unsafe {
        QueryFullProcessImageNameW(process.0, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len)
    };
    (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
}

/// Terminate every running process whose image is exactly `bin` (compared
/// case-insensitively, as Windows paths are). Returns how many.
pub(crate) fn terminate_image(bin: &Path) -> usize {
    let want = bin.to_string_lossy().to_lowercase();
    let file = bin
        .file_name()
        .map(|f| f.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    // SAFETY: a snapshot of every process; closed by `Handle`.
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap == INVALID_HANDLE_VALUE {
        return 0;
    }
    let snap = Handle(snap);
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut killed = 0;
    // SAFETY: a valid snapshot and an entry with dwSize set.
    let mut more = unsafe { Process32FirstW(snap.0, &mut entry) } != 0;
    while more {
        let len = entry
            .szExeFile
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(entry.szExeFile.len());
        let exe = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
        if exe == file {
            let pid = entry.th32ProcessID;
            // SAFETY: plain call; a null handle means we may not open it.
            let h = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
                    0,
                    pid,
                )
            };
            if !h.is_null() {
                let h = Handle(h);
                if image_path(&h).map(|p| p.to_lowercase()) == Some(want.clone()) {
                    // SAFETY: a handle opened with PROCESS_TERMINATE.
                    if unsafe { TerminateProcess(h.0, 1) } != 0 {
                        eprintln!(
                            "cumulusvpn-tunnel: stopped orphaned {} (pid {pid})",
                            bin.display()
                        );
                        killed += 1;
                    }
                }
            }
        }
        // SAFETY: as for Process32FirstW.
        more = unsafe { Process32NextW(snap.0, &mut entry) } != 0;
    }
    killed
}
