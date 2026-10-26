//! Removal of the Windows Firewall rule groups `CumulusVPN` and
//! `CumulusVPN-DNS`. CumulusVPN 1.2.0's kill switch is those groups plus
//! `DefaultOutboundAction Block` on every profile, and a machine where its
//! session died stays blocked by them until they are removed.
//!
//! Detection reads Windows Firewall's own rule store in the registry, in
//! microseconds. When rules are found, the NetSecurity cmdlets remove them.

use std::process::Command;
use std::ptr;

use windows_sys::Win32::Foundation::{ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, NO_ERROR};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ, REG_SZ,
};

use super::plan::firewall_rule_group;

const RULES_KEY: &str =
    r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules";

const KILL_SWITCH_GROUP: &str = "CumulusVPN";
const DNS_GROUP: &str = "CumulusVPN-DNS";

/// Which of the rule groups exist.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Present {
    pub(crate) kill_switch: bool,
    pub(crate) dns: bool,
}

pub(crate) fn present() -> Present {
    let mut found = Present::default();
    let key_name: Vec<u16> = RULES_KEY.encode_utf16().chain(std::iter::once(0)).collect();
    let mut key: HKEY = ptr::null_mut();
    // SAFETY: a NUL-terminated subkey and a valid out-pointer.
    if unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, key_name.as_ptr(), 0, KEY_READ, &mut key) }
        != NO_ERROR
    {
        return found;
    }
    let mut name = vec![0u16; 1024];
    let mut data = vec![0u8; 4096];
    let mut index = 0u32;
    loop {
        let mut name_len = name.len() as u32;
        let mut data_len = data.len() as u32;
        let mut kind = 0u32;
        // SAFETY: buffers with their sizes; the key is open.
        let rc = unsafe {
            RegEnumValueW(
                key,
                index,
                name.as_mut_ptr(),
                &mut name_len,
                ptr::null(),
                &mut kind,
                data.as_mut_ptr(),
                &mut data_len,
            )
        };
        if rc == ERROR_MORE_DATA {
            // Grow whichever buffer was short and read the same value again.
            data.resize(data.len().max(data_len as usize) * 2, 0);
            name.resize(name.len() * 2, 0);
            continue;
        }
        if rc == ERROR_NO_MORE_ITEMS || rc != NO_ERROR {
            break;
        }
        index += 1;
        if kind != REG_SZ {
            continue;
        }
        let units: Vec<u16> = data[..data_len as usize]
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .take_while(|u| *u != 0)
            .collect();
        let rule = String::from_utf16_lossy(&units);
        match firewall_rule_group(&rule) {
            Some(KILL_SWITCH_GROUP) => found.kill_switch = true,
            Some(DNS_GROUP) => found.dns = true,
            _ => {}
        }
    }
    // SAFETY: opened above, closed once.
    unsafe { RegCloseKey(key) };
    found
}

/// The cleanup script for what [`present`] found. The kill switch group comes
/// with `DefaultOutboundAction Block`, so the script sets `Allow` alongside
/// removing it, as that switch's own teardown does.
pub(crate) fn cleanup_script(found: Present) -> Option<String> {
    let mut steps = Vec::new();
    if found.kill_switch {
        steps.push("Set-NetFirewallProfile -All -DefaultOutboundAction Allow".to_string());
        steps.push(format!(
            "Remove-NetFirewallRule -Group '{KILL_SWITCH_GROUP}' -ErrorAction SilentlyContinue"
        ));
    }
    if found.dns {
        steps.push(format!(
            "Remove-NetFirewallRule -Group '{DNS_GROUP}' -ErrorAction SilentlyContinue"
        ));
    }
    (!steps.is_empty()).then(|| steps.join("; "))
}

/// Remove the rule groups that are present.
pub(crate) fn clean_up() {
    let found = present();
    let Some(script) = cleanup_script(found) else {
        return;
    };
    eprintln!("cumulusvpn-tunnel: removing Windows Firewall rule groups: {found:?}");
    let args = ["-NoProfile", "-NonInteractive", "-Command", script.as_str()];
    let _ = crate::run_logged(Command::new("powershell").args(args), "powershell", &args);
}

#[cfg(test)]
mod tests {
    use super::{cleanup_script, Present};

    #[test]
    fn nothing_present_runs_nothing() {
        assert_eq!(cleanup_script(Present::default()), None);
    }

    /// The kill switch group sets the profiles to Allow first, so traffic
    /// flows before its allow rules go.
    #[test]
    fn the_kill_switch_group_restores_allow_before_its_rules_go() {
        let s = cleanup_script(Present {
            kill_switch: true,
            dns: false,
        })
        .unwrap();
        assert_eq!(
            s,
            "Set-NetFirewallProfile -All -DefaultOutboundAction Allow; \
             Remove-NetFirewallRule -Group 'CumulusVPN' -ErrorAction SilentlyContinue"
        );
    }

    /// The DNS group alone leaves the profiles as they are.
    #[test]
    fn the_dns_group_alone_only_removes_its_rules() {
        let s = cleanup_script(Present {
            kill_switch: false,
            dns: true,
        })
        .unwrap();
        assert_eq!(
            s,
            "Remove-NetFirewallRule -Group 'CumulusVPN-DNS' -ErrorAction SilentlyContinue"
        );
    }
}
