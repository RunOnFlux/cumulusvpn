//! The Windows backend, all native calls: routes, addresses and adapter DNS
//! through IP Helper (`net`), the kill switch and DNS leak block as Windows
//! Filtering Platform filters (`wfp`), process checks (`process`), and removal
//! of the `CumulusVPN` Windows Firewall rule groups (`legacy`).
//!
//! `plan` holds the decisions as plain data and is compiled on every host, so
//! the Linux CI tests them too.

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) mod plan;

#[cfg(windows)]
pub(crate) mod legacy;
#[cfg(windows)]
pub(crate) mod net;
#[cfg(windows)]
pub(crate) mod process;
#[cfg(windows)]
pub(crate) mod wfp;

#[cfg(all(windows, test))]
mod system_tests;
