//! The Windows Filtering Platform: installs `super::plan` filter lists in our
//! own sublayers, and removes them.
//!
//! Everything here is ours: one provider and two sublayers under fixed GUIDs
//! (the kill switch, the DNS leak block), each replaced or cleared whole inside
//! one transaction, so every change is all-or-nothing.
//!
//! The objects are added from an ordinary session, so they outlive the process
//! that added them: a helper that crashes leaves the kill switch blocking
//! (fail-closed) until its restart clears the sublayers (`clear`, from startup
//! recovery). They live until removed or until the next boot, so every boot,
//! including after a power cut while connected, starts with a network.

use std::ffi::c_void;
use std::ptr;
use std::time::Instant;

use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::{
    FWP_E_ALREADY_EXISTS, FWP_E_FILTER_NOT_FOUND, FWP_E_IN_USE, FWP_E_PROVIDER_NOT_FOUND,
    FWP_E_SUBLAYER_NOT_FOUND, HANDLE,
};
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::*;
use windows_sys::Win32::System::Rpc::RPC_C_AUTHN_WINNT;

use super::plan::{Action, Cond, Family, FilterSpec};

const PROVIDER: GUID = GUID::from_u128(0x93232361_08d9_44e7_a555_489c9d8160de);

/// One of our sublayers. Each holds one feature's filters, so each is replaced
/// and cleared without touching the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Sublayer {
    KillSwitch,
    Dns,
}

impl Sublayer {
    fn key(self) -> GUID {
        match self {
            Sublayer::KillSwitch => GUID::from_u128(0xb14d6832_a522_450f_84c1_8407fc120380),
            Sublayer::Dns => GUID::from_u128(0x2de11f11_f0d3_491f_acc8_e3507d31237d),
        }
    }
    fn name(self) -> &'static str {
        match self {
            Sublayer::KillSwitch => "CumulusVPN kill switch",
            Sublayer::Dns => "CumulusVPN DNS leak block",
        }
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn same_guid(a: &GUID, b: &GUID) -> bool {
    a.data1 == b.data1 && a.data2 == b.data2 && a.data3 == b.data3 && a.data4 == b.data4
}

/// An FWP error, with the call that returned it, for the log.
fn fail(what: &str, code: u32) -> String {
    format!("{what} failed (0x{code:08x})")
}

/// An open engine session; closed on drop.
struct Engine(HANDLE);

impl Engine {
    fn open() -> Result<Engine, String> {
        let mut handle: HANDLE = ptr::null_mut();
        // SAFETY: no server name (local), no explicit identity, default
        // (non-dynamic) session; `handle` is a valid out-pointer.
        let rc = unsafe {
            FwpmEngineOpen0(
                ptr::null(),
                RPC_C_AUTHN_WINNT,
                ptr::null(),
                ptr::null(),
                &mut handle,
            )
        };
        if rc != 0 {
            return Err(fail("FwpmEngineOpen0", rc));
        }
        Ok(Engine(handle))
    }

    /// Run `body` in a transaction: committed if it succeeds, aborted (every
    /// change undone) if it fails.
    fn transaction<T>(&self, body: impl FnOnce(&Engine) -> Result<T, String>) -> Result<T, String> {
        // SAFETY: a valid engine handle.
        let rc = unsafe { FwpmTransactionBegin0(self.0, 0) };
        if rc != 0 {
            return Err(fail("FwpmTransactionBegin0", rc));
        }
        match body(self) {
            Ok(v) => {
                // SAFETY: a valid engine handle with a transaction open.
                let rc = unsafe { FwpmTransactionCommit0(self.0) };
                if rc != 0 {
                    return Err(fail("FwpmTransactionCommit0", rc));
                }
                Ok(v)
            }
            Err(e) => {
                // SAFETY: as above.
                unsafe { FwpmTransactionAbort0(self.0) };
                Err(e)
            }
        }
    }

    fn ensure(&self, sublayer: Sublayer) -> Result<(), String> {
        let name = wide("CumulusVPN");
        let mut provider: FWPM_PROVIDER0 = unsafe { std::mem::zeroed() };
        provider.providerKey = PROVIDER;
        provider.displayData.name = name.as_ptr() as *mut u16;
        // SAFETY: a valid handle and a fully initialized provider whose
        // strings outlive the call; no security descriptor (the default).
        let rc = unsafe { FwpmProviderAdd0(self.0, &provider, ptr::null_mut()) };
        if rc != 0 && rc != FWP_E_ALREADY_EXISTS as u32 {
            return Err(fail("FwpmProviderAdd0", rc));
        }
        let name = wide(sublayer.name());
        let mut provider_key = PROVIDER;
        let mut sub: FWPM_SUBLAYER0 = unsafe { std::mem::zeroed() };
        sub.subLayerKey = sublayer.key();
        sub.displayData.name = name.as_ptr() as *mut u16;
        sub.providerKey = &mut provider_key;
        // Above the system's own sublayers in evaluation order. Arbitration
        // makes a block in any sublayer final regardless of weight.
        sub.weight = u16::MAX;
        // SAFETY: as above.
        let rc = unsafe { FwpmSubLayerAdd0(self.0, &sub, ptr::null_mut()) };
        if rc != 0 && rc != FWP_E_ALREADY_EXISTS as u32 {
            return Err(fail("FwpmSubLayerAdd0", rc));
        }
        Ok(())
    }

    /// The ids of every filter in `sublayer`.
    fn filters_in(&self, sublayer: Sublayer) -> Result<Vec<u64>, String> {
        let key = sublayer.key();
        let mut ids = Vec::new();
        let mut enum_handle: HANDLE = ptr::null_mut();
        // SAFETY: no template (every filter); `enum_handle` is a valid
        // out-pointer.
        let rc = unsafe { FwpmFilterCreateEnumHandle0(self.0, ptr::null(), &mut enum_handle) };
        if rc != 0 {
            return Err(fail("FwpmFilterCreateEnumHandle0", rc));
        }
        let result = loop {
            let mut entries: *mut *mut FWPM_FILTER0 = ptr::null_mut();
            let mut n: u32 = 0;
            // SAFETY: valid handles; the engine allocates `entries`, freed
            // below with FwpmFreeMemory0.
            let rc = unsafe { FwpmFilterEnum0(self.0, enum_handle, 512, &mut entries, &mut n) };
            if rc != 0 {
                break Err(fail("FwpmFilterEnum0", rc));
            }
            for i in 0..n as usize {
                // SAFETY: the engine returned `n` valid filter pointers.
                let f = unsafe { &**entries.add(i) };
                if same_guid(&f.subLayerKey, &key) {
                    ids.push(f.filterId);
                }
            }
            if !entries.is_null() {
                // SAFETY: allocated by FwpmFilterEnum0.
                unsafe { FwpmFreeMemory0(&mut entries as *mut _ as *mut *mut c_void) };
            }
            if n == 0 {
                break Ok(());
            }
        };
        // SAFETY: a handle from FwpmFilterCreateEnumHandle0, destroyed once.
        unsafe { FwpmFilterDestroyEnumHandle0(self.0, enum_handle) };
        result.map(|()| ids)
    }

    fn delete_filters(&self, sublayer: Sublayer) -> Result<usize, String> {
        let ids = self.filters_in(sublayer)?;
        for id in &ids {
            // SAFETY: a valid handle and an id the engine just reported.
            let rc = unsafe { FwpmFilterDeleteById0(self.0, *id) };
            if rc != 0 && rc != FWP_E_FILTER_NOT_FOUND as u32 {
                return Err(fail("FwpmFilterDeleteById0", rc));
            }
        }
        Ok(ids.len())
    }

    fn add(&self, sublayer: Sublayer, spec: &FilterSpec) -> Result<(), String> {
        let mut store = Store::default();
        let mut conds: Vec<FWPM_FILTER_CONDITION0> =
            spec.conds.iter().map(|c| store.condition(c)).collect();
        let name = wide(spec.name);
        let mut provider_key = PROVIDER;
        let mut f: FWPM_FILTER0 = unsafe { std::mem::zeroed() };
        // A zero filterKey: the engine assigns one.
        f.displayData.name = name.as_ptr() as *mut u16;
        f.flags = FWPM_FILTER_FLAG_NONE;
        f.providerKey = &mut provider_key;
        f.layerKey = match spec.family {
            Family::V4 => FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            Family::V6 => FWPM_LAYER_ALE_AUTH_CONNECT_V6,
        };
        f.subLayerKey = sublayer.key();
        f.weight.r#type = FWP_UINT8;
        f.weight.Anonymous.uint8 = spec.weight;
        f.numFilterConditions = conds.len() as u32;
        f.filterCondition = if conds.is_empty() {
            ptr::null_mut()
        } else {
            conds.as_mut_ptr()
        };
        f.action.r#type = match spec.action {
            Action::Permit => FWP_ACTION_PERMIT,
            Action::Block => FWP_ACTION_BLOCK,
        };
        let mut id = 0u64;
        // SAFETY: `f`, its conditions and everything they point to (`store`,
        // `name`, `provider_key`) are alive for the call, which copies them.
        let rc = unsafe { FwpmFilterAdd0(self.0, &f, ptr::null_mut(), &mut id) };
        if rc != 0 {
            return Err(fail(&format!("FwpmFilterAdd0 ({})", spec.name), rc));
        }
        Ok(())
    }

    /// Remove a sublayer (and the provider, once neither sublayer is left).
    /// Its filters must already be gone.
    fn delete_sublayer(&self, sublayer: Sublayer) -> Result<(), String> {
        let key = sublayer.key();
        // SAFETY: a valid handle and key.
        let rc = unsafe { FwpmSubLayerDeleteByKey0(self.0, &key) };
        if rc != 0 && rc != FWP_E_SUBLAYER_NOT_FOUND as u32 {
            return Err(fail("FwpmSubLayerDeleteByKey0", rc));
        }
        // SAFETY: as above. IN_USE: the other sublayer still references it.
        let rc = unsafe { FwpmProviderDeleteByKey0(self.0, &PROVIDER) };
        if rc != 0 && rc != FWP_E_IN_USE as u32 && rc != FWP_E_PROVIDER_NOT_FOUND as u32 {
            return Err(fail("FwpmProviderDeleteByKey0", rc));
        }
        Ok(())
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // SAFETY: a handle from FwpmEngineOpen0, closed once.
        unsafe { FwpmEngineClose0(self.0) };
    }
}

/// Owns the values filter conditions point at. Each value is boxed so its
/// address stays fixed while the vectors holding the boxes grow: the
/// conditions keep raw pointers to them until `FwpmFilterAdd0` returns.
#[derive(Default)]
#[allow(clippy::vec_box)]
struct Store {
    u64s: Vec<Box<u64>>,
    v4: Vec<Box<FWP_V4_ADDR_AND_MASK>>,
    v6: Vec<Box<FWP_V6_ADDR_AND_MASK>>,
    bytes16: Vec<Box<FWP_BYTE_ARRAY16>>,
}

impl Store {
    fn condition(&mut self, c: &Cond) -> FWPM_FILTER_CONDITION0 {
        let mut out: FWPM_FILTER_CONDITION0 = unsafe { std::mem::zeroed() };
        out.matchType = FWP_MATCH_EQUAL;
        let v = &mut out.conditionValue;
        match *c {
            Cond::RemoteAddr(std::net::IpAddr::V4(a)) => {
                out.fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
                v.r#type = FWP_UINT32;
                v.Anonymous.uint32 = u32::from(a);
            }
            Cond::RemoteAddr(std::net::IpAddr::V6(a)) => {
                out.fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
                let mut b = Box::new(FWP_BYTE_ARRAY16 {
                    byteArray16: a.octets(),
                });
                v.r#type = FWP_BYTE_ARRAY16_TYPE;
                v.Anonymous.byteArray16 = &mut *b;
                self.bytes16.push(b);
            }
            Cond::RemotePrefix(std::net::IpAddr::V4(a), len) => {
                out.fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
                let mask = if len == 0 {
                    0
                } else {
                    u32::MAX << (32 - u32::from(len))
                };
                let mut m = Box::new(FWP_V4_ADDR_AND_MASK {
                    addr: u32::from(a) & mask,
                    mask,
                });
                v.r#type = FWP_V4_ADDR_MASK;
                v.Anonymous.v4AddrMask = &mut *m;
                self.v4.push(m);
            }
            Cond::RemotePrefix(std::net::IpAddr::V6(a), len) => {
                out.fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
                let mut m = Box::new(FWP_V6_ADDR_AND_MASK {
                    addr: a.octets(),
                    prefixLength: len,
                });
                v.r#type = FWP_V6_ADDR_MASK;
                v.Anonymous.v6AddrMask = &mut *m;
                self.v6.push(m);
            }
            Cond::RemotePort(p) => {
                out.fieldKey = FWPM_CONDITION_IP_REMOTE_PORT;
                v.r#type = FWP_UINT16;
                v.Anonymous.uint16 = p;
            }
            Cond::LocalPort(p) => {
                out.fieldKey = FWPM_CONDITION_IP_LOCAL_PORT;
                v.r#type = FWP_UINT16;
                v.Anonymous.uint16 = p;
            }
            Cond::Protocol(p) => {
                out.fieldKey = FWPM_CONDITION_IP_PROTOCOL;
                v.r#type = FWP_UINT8;
                v.Anonymous.uint8 = p;
            }
            Cond::LocalInterface(luid) => {
                out.fieldKey = FWPM_CONDITION_IP_LOCAL_INTERFACE;
                let mut b = Box::new(luid);
                v.r#type = FWP_UINT64;
                v.Anonymous.uint64 = &mut *b;
                self.u64s.push(b);
            }
            Cond::Loopback => {
                out.fieldKey = FWPM_CONDITION_FLAGS;
                out.matchType = FWP_MATCH_FLAGS_ALL_SET;
                v.r#type = FWP_UINT32;
                v.Anonymous.uint32 = FWP_CONDITION_FLAG_IS_LOOPBACK;
            }
        }
        out
    }
}

/// Make `sublayer` hold exactly `specs`, atomically.
pub(crate) fn replace(sublayer: Sublayer, specs: &[FilterSpec]) -> Result<(), String> {
    let started = Instant::now();
    let engine = Engine::open()?;
    let removed = engine.transaction(|e| {
        e.ensure(sublayer)?;
        let removed = e.delete_filters(sublayer)?;
        for spec in specs {
            e.add(sublayer, spec)?;
        }
        Ok(removed)
    })?;
    eprintln!(
        "cumulusvpn-tunnel: wfp: {} = {} filters (replaced {removed}) in {} ms",
        sublayer.name(),
        specs.len(),
        started.elapsed().as_millis()
    );
    Ok(())
}

/// Remove `sublayer` and all its filters, atomically. A no-op when absent.
pub(crate) fn clear(sublayer: Sublayer) -> Result<(), String> {
    let started = Instant::now();
    let engine = Engine::open()?;
    let removed = engine.transaction(|e| {
        let removed = e.delete_filters(sublayer)?;
        e.delete_sublayer(sublayer)?;
        Ok(removed)
    })?;
    if removed > 0 {
        eprintln!(
            "cumulusvpn-tunnel: wfp: {} cleared ({removed} filters) in {} ms",
            sublayer.name(),
            started.elapsed().as_millis()
        );
    }
    Ok(())
}

/// How many filters `sublayer` holds right now.
pub(crate) fn count(sublayer: Sublayer) -> Result<usize, String> {
    Ok(Engine::open()?.filters_in(sublayer)?.len())
}
