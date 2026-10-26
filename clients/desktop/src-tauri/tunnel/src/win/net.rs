//! Interfaces, routes, addresses and adapter DNS through the IP Helper API,
//! each a single call into the stack.
//!
//! **Removal deletes exactly our own routes.** Every route this module creates
//! is recorded with the interface and next hop it was created with, and removal
//! deletes exactly those rows, so a route that shares a prefix with ours (the
//! LAN's own `192.168.1.0/24` beside a split-tunnel bypass of the same prefix)
//! stays. A route that is already present when we add it belongs to the system
//! or the user; it stays out of the record and stays in the table.
//!
//! Routes on the physical interface (the endpoint pin, split-tunnel bypasses)
//! are also recorded on disk (`routes.txt` next to the executable), so after a
//! crash the next start's [`recover_stale`] deletes exactly those. Routes on a
//! tunnel adapter go with the adapter, which recovery removes along with its
//! `wireguard-go`.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::ptr;
use std::sync::Mutex;

use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, ERROR_OBJECT_ALREADY_EXISTS, NO_ERROR};
use windows_sys::Win32::NetworkManagement::IpHelper::*;
use windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH;
use windows_sys::Win32::Networking::WinSock::{
    IpDadStatePreferred, ADDRESS_FAMILY, AF_INET, AF_INET6, SOCKADDR_INET,
};

use super::plan::{best_default, format_routes, parse_routes, DefaultRoute, RecordedRoute};

#[link(name = "dnsapi")]
extern "system" {
    /// Exported by dnsapi.dll (what `ipconfig /flushdns` calls); declared here
    /// because windows-sys has no binding for it.
    fn DnsFlushResolverCache() -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn fail(what: &str, code: u32) -> String {
    format!("{what} failed (error {code})")
}

fn family(ip: &IpAddr) -> ADDRESS_FAMILY {
    match ip {
        IpAddr::V4(_) => AF_INET,
        IpAddr::V6(_) => AF_INET6,
    }
}

fn sockaddr(ip: &IpAddr) -> SOCKADDR_INET {
    let mut sa: SOCKADDR_INET = unsafe { std::mem::zeroed() };
    match ip {
        IpAddr::V4(a) => {
            sa.Ipv4.sin_family = AF_INET;
            // In network byte order: the octets as they appear.
            sa.Ipv4.sin_addr.S_un.S_addr = u32::from_ne_bytes(a.octets());
        }
        IpAddr::V6(a) => {
            sa.Ipv6.sin6_family = AF_INET6;
            sa.Ipv6.sin6_addr.u.Byte = a.octets();
        }
    }
    sa
}

/// The unspecified address of a family: an on-link next hop.
fn unspecified(family: ADDRESS_FAMILY) -> SOCKADDR_INET {
    if family == AF_INET6 {
        sockaddr(&IpAddr::V6(Ipv6Addr::UNSPECIFIED))
    } else {
        sockaddr(&IpAddr::V4(Ipv4Addr::UNSPECIFIED))
    }
}

fn ip_of(sa: &SOCKADDR_INET) -> Option<IpAddr> {
    // SAFETY: `si_family` is the common first field of every variant.
    let fam = unsafe { sa.si_family };
    if fam == AF_INET {
        // SAFETY: the family says this is the IPv4 variant.
        let raw = unsafe { sa.Ipv4.sin_addr.S_un.S_addr };
        Some(IpAddr::V4(Ipv4Addr::from(raw.to_ne_bytes())))
    } else if fam == AF_INET6 {
        // SAFETY: the family says this is the IPv6 variant.
        Some(IpAddr::V6(Ipv6Addr::from(unsafe {
            sa.Ipv6.sin6_addr.u.Byte
        })))
    } else {
        None
    }
}

/// The LUID of the interface named `alias` (`cvpn0`, `Wi-Fi`).
pub(crate) fn luid_of(alias: &str) -> Result<u64, String> {
    let name = wide(alias);
    let mut luid = NET_LUID_LH { Value: 0 };
    // SAFETY: a NUL-terminated name and a valid out-pointer.
    let rc = unsafe { ConvertInterfaceAliasToLuid(name.as_ptr(), &mut luid) };
    if rc != NO_ERROR {
        return Err(fail(&format!("looking up interface {alias}"), rc));
    }
    // SAFETY: written by the call above.
    Ok(unsafe { luid.Value })
}

fn luid(value: u64) -> NET_LUID_LH {
    NET_LUID_LH { Value: value }
}

/// Whether an interface with this LUID still exists.
fn interface_exists(value: u64) -> bool {
    let mut index = 0u32;
    // SAFETY: valid in and out pointers.
    unsafe { ConvertInterfaceLuidToIndex(&luid(value), &mut index) == NO_ERROR }
}

fn interface_row(value: u64, family: ADDRESS_FAMILY) -> Result<MIB_IPINTERFACE_ROW, String> {
    let mut row: MIB_IPINTERFACE_ROW = unsafe { std::mem::zeroed() };
    // SAFETY: a valid row to initialize, then to fill.
    unsafe { InitializeIpInterfaceEntry(&mut row) };
    row.Family = family;
    row.InterfaceLuid = luid(value);
    // SAFETY: as above.
    let rc = unsafe { GetIpInterfaceEntry(&mut row) };
    if rc != NO_ERROR {
        return Err(fail("GetIpInterfaceEntry", rc));
    }
    Ok(row)
}

/// Set an interface's IPv4 MTU and/or metric (`None` leaves it).
pub(crate) fn set_ipv4_interface(
    value: u64,
    mtu: Option<u32>,
    metric: Option<u32>,
) -> Result<(), String> {
    let mut row = interface_row(value, AF_INET)?;
    if let Some(mtu) = mtu {
        row.NlMtu = mtu;
    }
    if let Some(metric) = metric {
        row.UseAutomaticMetric = false;
        row.Metric = metric;
    }
    // SetIpInterfaceEntry rejects an IPv4 row whose SitePrefixLength is not
    // zero, which is what GetIpInterfaceEntry hands back.
    row.SitePrefixLength = 0;
    // SAFETY: a row read back from the stack and edited in place.
    let rc = unsafe { SetIpInterfaceEntry(&mut row) };
    if rc != NO_ERROR {
        return Err(fail("SetIpInterfaceEntry", rc));
    }
    Ok(())
}

/// Give the interface exactly one IPv4 address, `addr/32` (wintun is
/// point-to-point: the routes do the steering). Any other IPv4 address on it
/// is removed first.
pub(crate) fn set_ipv4_address(value: u64, addr: Ipv4Addr) -> Result<(), String> {
    eprintln!("cumulusvpn-tunnel: interface {value}: setting IPv4 address {addr}/32");
    let mut existing_ok = false;
    for row in ipv4_addresses() {
        if row.luid != value {
            continue;
        }
        if row.addr == IpAddr::V4(addr) && row.prefix_len == 32 {
            existing_ok = true;
            continue;
        }
        // SAFETY: a row the stack returned identifies the entry to delete.
        let rc = unsafe { DeleteUnicastIpAddressEntry(&row.raw) };
        eprintln!(
            "cumulusvpn-tunnel: interface {value}: removed {}/{} (error {rc})",
            row.addr, row.prefix_len
        );
    }
    if existing_ok {
        log_ipv4_addresses(value);
        return Ok(());
    }
    let mut row: MIB_UNICASTIPADDRESS_ROW = unsafe { std::mem::zeroed() };
    // SAFETY: a valid row to initialize.
    unsafe { InitializeUnicastIpAddressEntry(&mut row) };
    row.Address = sockaddr(&IpAddr::V4(addr));
    row.InterfaceLuid = luid(value);
    row.OnLinkPrefixLength = 32;
    row.DadState = IpDadStatePreferred;
    // SAFETY: an initialized row.
    let rc = unsafe { CreateUnicastIpAddressEntry(&row) };
    eprintln!(
        "cumulusvpn-tunnel: interface {value}: CreateUnicastIpAddressEntry {addr}/32 (error {rc})"
    );
    log_ipv4_addresses(value);
    if rc == ERROR_OBJECT_ALREADY_EXISTS {
        // Windows holds an IPv4 address on one interface at a time.
        let holders: Vec<String> = ipv4_addresses()
            .iter()
            .filter(|r| r.addr == IpAddr::V4(addr))
            .map(|r| r.luid.to_string())
            .collect();
        return Err(format!(
            "{addr} is already on interface {}",
            holders.join(", ")
        ));
    }
    if rc != NO_ERROR {
        return Err(fail("CreateUnicastIpAddressEntry", rc));
    }
    Ok(())
}

/// One IPv4 unicast address of the stack, as the address table reports it.
struct AddressRow {
    luid: u64,
    addr: IpAddr,
    prefix_len: u8,
    dad_state: i32,
    raw: MIB_UNICASTIPADDRESS_ROW,
}

/// Every IPv4 unicast address on the machine.
fn ipv4_addresses() -> Vec<AddressRow> {
    let mut table: *mut MIB_UNICASTIPADDRESS_TABLE = ptr::null_mut();
    // SAFETY: a valid out-pointer; freed below with FreeMibTable.
    if unsafe { GetUnicastIpAddressTable(AF_INET, &mut table) } != NO_ERROR {
        return Vec::new();
    }
    // SAFETY: the stack returned a table of `NumEntries` rows.
    let rows = unsafe {
        std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize)
    };
    let out = rows
        .iter()
        .filter_map(|r| {
            Some(AddressRow {
                // SAFETY: plain read of a returned row.
                luid: unsafe { r.InterfaceLuid.Value },
                addr: ip_of(&r.Address)?,
                prefix_len: r.OnLinkPrefixLength,
                dad_state: r.DadState,
                raw: *r,
            })
        })
        .collect();
    // SAFETY: allocated by GetUnicastIpAddressTable.
    unsafe { FreeMibTable(table as *const _) };
    out
}

/// Log the IPv4 addresses on an interface with their duplicate-detection
/// state (`NL_DAD_STATE`: 0 invalid, 1 tentative, 2 duplicate, 3 deprecated,
/// 4 preferred).
fn log_ipv4_addresses(value: u64) {
    let rows: Vec<String> = ipv4_addresses()
        .iter()
        .filter(|r| r.luid == value)
        .map(|r| format!("{}/{} DAD {}", r.addr, r.prefix_len, r.dad_state))
        .collect();
    eprintln!(
        "cumulusvpn-tunnel: interface {value}: IPv4 now [{}]",
        rows.join(", ")
    );
}

/// The default route the stack would use for IPv4: next hop and interface.
pub(crate) fn default_route_v4() -> Result<Option<DefaultRoute>, String> {
    let mut table: *mut MIB_IPFORWARD_TABLE2 = ptr::null_mut();
    // SAFETY: a valid out-pointer; freed below with FreeMibTable.
    let rc = unsafe { GetIpForwardTable2(AF_INET, &mut table) };
    if rc != NO_ERROR {
        return Err(fail("GetIpForwardTable2", rc));
    }
    // SAFETY: the stack returned a table of `NumEntries` rows.
    let rows = unsafe {
        std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize)
    };
    let mut candidates = Vec::new();
    for row in rows {
        if row.DestinationPrefix.PrefixLength != 0 {
            continue;
        }
        let Some(next_hop) = ip_of(&row.NextHop) else {
            continue;
        };
        // SAFETY: plain read of a returned row.
        let value = unsafe { row.InterfaceLuid.Value };
        let Ok(iface) = interface_row(value, AF_INET) else {
            continue;
        };
        candidates.push(DefaultRoute {
            next_hop,
            luid: value,
            cost: u64::from(row.Metric) + u64::from(iface.Metric),
        });
    }
    // SAFETY: allocated by GetIpForwardTable2.
    unsafe { FreeMibTable(table as *const _) };
    Ok(best_default(&candidates))
}

/// Where a route lives, which decides what outlives this process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scope {
    /// On the physical interface: stays until deleted, so it is recorded on
    /// disk for [`recover_stale`].
    Physical,
    /// On a tunnel adapter: goes with the adapter.
    Tunnel,
}

/// The routes this module created and has not removed. The `Physical` ones
/// are also in [`record_path`], rewritten whenever they change.
static OURS: Mutex<Vec<(RecordedRoute, Scope)>> = Mutex::new(Vec::new());

/// The route record on disk: next to our executable, in the install
/// directory, writable only by Administrators and SYSTEM. It outlives a crash
/// of this process, so the next start's [`recover_stale`] deletes exactly the
/// routes it lists.
fn record_path() -> Option<std::path::PathBuf> {
    Some(std::env::current_exe().ok()?.parent()?.join("routes.txt"))
}

/// Write the `Physical` routes to the record (a temporary file renamed over
/// it, so a crash leaves either the old record or the new one). An empty
/// record is no file.
fn persist(ours: &[(RecordedRoute, Scope)]) {
    let ours: Vec<RecordedRoute> = ours
        .iter()
        .filter(|(_, scope)| *scope == Scope::Physical)
        .map(|(r, _)| *r)
        .collect();
    let Some(path) = record_path() else {
        eprintln!("cumulusvpn-tunnel: route record: cannot locate the install directory");
        return;
    };
    let result = if ours.is_empty() {
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    } else {
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, format_routes(&ours)).and_then(|()| std::fs::rename(&tmp, &path))
    };
    if let Err(e) = result {
        eprintln!("cumulusvpn-tunnel: route record {}: {e}", path.display());
    }
}

fn route_row(r: &RecordedRoute) -> MIB_IPFORWARD_ROW2 {
    let mut row: MIB_IPFORWARD_ROW2 = unsafe { std::mem::zeroed() };
    // SAFETY: a valid row to initialize.
    unsafe { InitializeIpForwardEntry(&mut row) };
    row.InterfaceLuid = luid(r.luid);
    row.DestinationPrefix.Prefix = sockaddr(&r.prefix.0);
    row.DestinationPrefix.PrefixLength = r.prefix.1;
    row.NextHop = match &r.next_hop {
        Some(hop) => sockaddr(hop),
        None => unspecified(family(&r.prefix.0)),
    };
    row.Metric = 0;
    row
}

/// What deleting one route did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Deleted {
    Yes,
    AlreadyGone,
    Failed,
}

/// Delete exactly the route `r` names.
fn delete_route(r: &RecordedRoute) -> Deleted {
    // SAFETY: an initialized row naming exactly the route we created.
    let rc = unsafe { DeleteIpForwardEntry2(&route_row(r)) };
    match rc {
        NO_ERROR => Deleted::Yes,
        ERROR_NOT_FOUND => Deleted::AlreadyGone,
        _ => {
            eprintln!(
                "cumulusvpn-tunnel: removing route {}/{} failed (error {rc})",
                r.prefix.0, r.prefix.1
            );
            Deleted::Failed
        }
    }
}

/// Route `prefix` out the interface `luid_value`, via `next_hop` or on-link.
pub(crate) fn add_route(
    prefix: (IpAddr, u8),
    luid_value: u64,
    next_hop: Option<IpAddr>,
    scope: Scope,
) -> Result<(), String> {
    let r = RecordedRoute {
        prefix,
        luid: luid_value,
        next_hop,
    };
    // SAFETY: an initialized row.
    let rc = unsafe { CreateIpForwardEntry2(&route_row(&r)) };
    if rc == ERROR_OBJECT_ALREADY_EXISTS {
        eprintln!(
            "cumulusvpn-tunnel: route {}/{} was already there; left as the system's",
            prefix.0, prefix.1
        );
        return Ok(());
    }
    if rc != NO_ERROR {
        return Err(fail(&format!("adding route {}/{}", prefix.0, prefix.1), rc));
    }
    let mut ours = OURS.lock().expect("route record poisoned");
    // Routes on an interface that is gone went with it.
    ours.retain(|(o, _)| interface_exists(o.luid));
    ours.push((r, scope));
    if scope == Scope::Physical {
        persist(&ours);
    }
    Ok(())
}

/// Delete every route we created for `prefix`, on whichever interface.
pub(crate) fn remove_routes(prefix: (IpAddr, u8)) {
    let mut ours = OURS.lock().expect("route record poisoned");
    let mut physical_removed = false;
    ours.retain(|(r, scope)| {
        if r.prefix != prefix {
            return true;
        }
        let _ = delete_route(r);
        physical_removed |= *scope == Scope::Physical;
        false
    });
    if physical_removed {
        persist(&ours);
    }
}

/// At startup, before any session: delete the routes a previous process of
/// ours created and left (it crashed or was killed), as listed in its record,
/// then clear the record.
pub(crate) fn recover_stale() {
    let Some(path) = record_path() else {
        return;
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            eprintln!("cumulusvpn-tunnel: route record {}: {e}", path.display());
            return;
        }
    };
    let (routes, bad) = parse_routes(&text);
    for line in &bad {
        eprintln!("cumulusvpn-tunnel: route record: unreadable line {line:?}");
    }
    let results: Vec<Deleted> = routes.iter().map(delete_route).collect();
    let count = |d: Deleted| results.iter().filter(|r| **r == d).count();
    eprintln!(
        "cumulusvpn-tunnel: route record from a previous session: {} deleted, {} already gone, {} failed",
        count(Deleted::Yes),
        count(Deleted::AlreadyGone),
        count(Deleted::Failed)
    );
    let mut ours = OURS.lock().expect("route record poisoned");
    ours.clear();
    persist(&ours);
}

/// Point the adapter at `servers` (both families), with an empty connection
/// suffix and dynamic DNS registration off. An empty list resets it.
pub(crate) fn set_dns_servers(value: u64, servers: &[IpAddr]) -> Result<(), String> {
    let mut guid: GUID = unsafe { std::mem::zeroed() };
    // SAFETY: valid in and out pointers.
    let rc = unsafe { ConvertInterfaceLuidToGuid(&luid(value), &mut guid) };
    if rc != NO_ERROR {
        return Err(fail("ConvertInterfaceLuidToGuid", rc));
    }
    for v6 in [false, true] {
        let list: Vec<String> = servers
            .iter()
            .filter(|s| s.is_ipv6() == v6)
            .map(IpAddr::to_string)
            .collect();
        if v6 && list.is_empty() {
            continue;
        }
        let mut name_servers = wide(&list.join(","));
        let mut domain = wide("");
        let mut settings: DNS_INTERFACE_SETTINGS = unsafe { std::mem::zeroed() };
        settings.Version = DNS_INTERFACE_SETTINGS_VERSION1;
        settings.Flags = u64::from(DNS_SETTING_NAMESERVER);
        settings.NameServer = name_servers.as_mut_ptr();
        if v6 {
            settings.Flags |= u64::from(DNS_SETTING_IPV6);
        } else {
            settings.Flags |= u64::from(DNS_SETTING_DOMAIN | DNS_SETTING_REGISTRATION_ENABLED);
            settings.Domain = domain.as_mut_ptr();
            settings.RegistrationEnabled = 0;
        }
        // SAFETY: an initialized settings block whose strings outlive the call.
        let rc = unsafe { SetInterfaceDnsSettings(guid, &settings) };
        if rc != NO_ERROR {
            return Err(fail("SetInterfaceDnsSettings", rc));
        }
    }
    Ok(())
}

/// Empty the resolver cache, so every lookup goes to the current servers.
pub(crate) fn flush_dns_cache() {
    // SAFETY: no arguments; returns a BOOL.
    if unsafe { DnsFlushResolverCache() } == 0 {
        eprintln!("cumulusvpn-tunnel: DnsFlushResolverCache failed");
    }
}

/// The alias (`Wi-Fi`) of the interface with this LUID.
#[cfg(test)]
pub(crate) fn alias_of(value: u64) -> String {
    let mut buf = [0u16; 257];
    // SAFETY: valid in pointer, a buffer and its length in characters.
    let rc = unsafe { ConvertInterfaceLuidToAlias(&luid(value), buf.as_mut_ptr(), buf.len()) };
    assert_eq!(rc, NO_ERROR, "ConvertInterfaceLuidToAlias");
    let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

/// Whether the IPv4 table holds `prefix` on interface `luid_value`.
#[cfg(test)]
pub(crate) fn route_present(prefix: (IpAddr, u8), luid_value: u64) -> bool {
    let mut table: *mut MIB_IPFORWARD_TABLE2 = ptr::null_mut();
    // SAFETY: a valid out-pointer; freed below.
    if unsafe { GetIpForwardTable2(family(&prefix.0), &mut table) } != NO_ERROR {
        return false;
    }
    // SAFETY: the stack returned a table of `NumEntries` rows.
    let rows = unsafe {
        std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize)
    };
    let found = rows.iter().any(|r| {
        // SAFETY: plain read of a returned row.
        let luid = unsafe { r.InterfaceLuid.Value };
        luid == luid_value
            && r.DestinationPrefix.PrefixLength == prefix.1
            && ip_of(&r.DestinationPrefix.Prefix) == Some(prefix.0)
    });
    // SAFETY: allocated by GetIpForwardTable2.
    unsafe { FreeMibTable(table as *const _) };
    found
}

#[cfg(test)]
pub(crate) fn our_routes() -> Vec<((IpAddr, u8), u64, Option<IpAddr>)> {
    OURS.lock()
        .expect("route record poisoned")
        .iter()
        .map(|(r, _)| (r.prefix, r.luid, r.next_hop))
        .collect()
}

/// What a crash does to this process's record: the memory is gone, the routes
/// and the file stay.
#[cfg(test)]
pub(crate) fn forget_in_memory() {
    OURS.lock().expect("route record poisoned").clear();
}

#[cfg(test)]
pub(crate) fn record_file() -> std::path::PathBuf {
    record_path().expect("install directory")
}
