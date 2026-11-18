//! Windows routing through the IP Helper API (iphlpapi), in-process.
//!
//! The endpoint bypass used to cost three process starts per connect — two
//! `powershell Get-NetRoute` lookups (gateway, then interface) and a `netsh`
//! add — and a `powershell Remove-NetRoute` per disconnect. Measured on a real
//! PC that was 3.8 s of every connect and most of 1.8 s of every disconnect
//! (tunnel::trace). These calls take milliseconds. `routing.rs` falls back to
//! the old commands if any of them fails, so this can only make things faster.
//!
//! IPv4 only, like the endpoint bypass it serves.

use std::net::Ipv4Addr;

use windows_sys::Win32::Foundation::{ERROR_OBJECT_ALREADY_EXISTS, NO_ERROR};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    CreateIpForwardEntry2, DeleteIpForwardEntry2, FreeMibTable, GetIpForwardTable2,
    GetIpInterfaceEntry, InitializeIpForwardEntry, InitializeIpInterfaceEntry, MIB_IPFORWARD_ROW2,
    MIB_IPFORWARD_TABLE2, MIB_IPINTERFACE_ROW,
};
use windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH;
use windows_sys::Win32::Networking::WinSock::{
    AF_INET, IN_ADDR, IN_ADDR_0, MIB_IPPROTO_NETMGMT, SOCKADDR_IN, SOCKADDR_INET,
};

/// The route the stack itself would use for the internet: the IPv4 default
/// route with the lowest route + interface metric (how Windows picks between,
/// say, Wi-Fi and Ethernet). On-link defaults (a tunnel's) are skipped — the
/// bypass needs a real next hop.
pub struct DefaultRoute {
    pub gateway: Ipv4Addr,
    luid: NET_LUID_LH,
}

fn v4_of(sa: &SOCKADDR_INET) -> Option<Ipv4Addr> {
    // SAFETY: every variant of the union starts with the address family, so
    // reading it is always defined; the Ipv4 view is read only when it says so.
    unsafe {
        if sa.si_family != AF_INET {
            return None;
        }
        Some(Ipv4Addr::from(sa.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()))
    }
}

fn sockaddr_v4(ip: Ipv4Addr) -> SOCKADDR_INET {
    SOCKADDR_INET {
        Ipv4: SOCKADDR_IN {
            sin_family: AF_INET,
            sin_port: 0,
            sin_addr: IN_ADDR {
                S_un: IN_ADDR_0 {
                    S_addr: u32::from_ne_bytes(ip.octets()),
                },
            },
            sin_zero: [0; 8],
        },
    }
}

/// Every IPv4 route, copied out of the OS table (which is freed here).
fn ipv4_routes() -> Option<Vec<MIB_IPFORWARD_ROW2>> {
    let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    // SAFETY: the API allocates the table and hands back ownership; it is read
    // within its own NumEntries and released with FreeMibTable below.
    unsafe {
        if GetIpForwardTable2(AF_INET, &mut table) != NO_ERROR || table.is_null() {
            return None;
        }
        let count = (*table).NumEntries as usize;
        let first = std::ptr::addr_of!((*table).Table).cast::<MIB_IPFORWARD_ROW2>();
        let rows = std::slice::from_raw_parts(first, count).to_vec();
        FreeMibTable(table as *const core::ffi::c_void);
        Some(rows)
    }
}

fn interface_metric(luid: NET_LUID_LH) -> Option<u32> {
    // SAFETY: a zeroed row initialised by the API, then filled by it.
    unsafe {
        let mut row: MIB_IPINTERFACE_ROW = std::mem::zeroed();
        InitializeIpInterfaceEntry(&mut row);
        row.Family = AF_INET;
        row.InterfaceLuid = luid;
        if GetIpInterfaceEntry(&mut row) != NO_ERROR {
            return None;
        }
        Some(row.Metric)
    }
}

pub fn default_route() -> Option<DefaultRoute> {
    ipv4_routes()?
        .iter()
        .filter(|r| r.DestinationPrefix.PrefixLength == 0)
        .filter_map(|r| {
            let gateway = v4_of(&r.NextHop).filter(|g| !g.is_unspecified())?;
            let metric = r.Metric.saturating_add(interface_metric(r.InterfaceLuid)?);
            Some((metric, gateway, r.InterfaceLuid))
        })
        .min_by_key(|(metric, _, _)| *metric)
        .map(|(_, gateway, luid)| DefaultRoute { gateway, luid })
}

/// Pin `dest` to `via` with a host route, replacing any older one for `dest`
/// (left from a previous network, it would point at a router that is gone).
pub fn add_host_route(dest: Ipv4Addr, via: &DefaultRoute) -> Result<(), u32> {
    delete_host_routes(dest);
    // SAFETY: a zeroed row initialised by the API, then given plain values.
    let rc = unsafe {
        let mut row: MIB_IPFORWARD_ROW2 = std::mem::zeroed();
        InitializeIpForwardEntry(&mut row);
        row.InterfaceLuid = via.luid;
        row.DestinationPrefix.Prefix = sockaddr_v4(dest);
        row.DestinationPrefix.PrefixLength = 32;
        row.NextHop = sockaddr_v4(via.gateway);
        row.Metric = 0;
        row.Protocol = MIB_IPPROTO_NETMGMT;
        CreateIpForwardEntry2(&row)
    };
    if rc == NO_ERROR || rc == ERROR_OBJECT_ALREADY_EXISTS {
        Ok(())
    } else {
        Err(rc)
    }
}

/// Remove every host route to `dest`. False only when the route table could
/// not be read at all (the caller then falls back to the old command).
pub fn delete_host_routes(dest: Ipv4Addr) -> bool {
    let Some(rows) = ipv4_routes() else {
        return false;
    };
    for row in rows.iter().filter(|r| {
        r.DestinationPrefix.PrefixLength == 32 && v4_of(&r.DestinationPrefix.Prefix) == Some(dest)
    }) {
        // SAFETY: the row came from the OS table, as DeleteIpForwardEntry2 expects.
        unsafe {
            DeleteIpForwardEntry2(row);
        }
    }
    true
}
