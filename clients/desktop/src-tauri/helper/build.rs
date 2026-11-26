//! Stamp the helper with the app's release version.
//!
//! The crate itself stays at 0.1.0 (it is never published); what an operator
//! or a bug report needs from `--ping` / `--version` is the CumulusVPN release
//! the helper shipped with, and that lives in `tauri.conf.json`, which the
//! release process bumps. Parsed by hand to keep build dependencies at zero.

use std::fs;

fn main() {
    let conf = "../tauri.conf.json";
    println!("cargo:rerun-if-changed={conf}");
    let version = fs::read_to_string(conf)
        .ok()
        .and_then(|text| release_version(&text))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    println!("cargo:rustc-env=CUMULUSVPN_VERSION={version}");
}

/// The top-level `"version": "x.y.z"` of tauri.conf.json (the first one in the
/// file, which is where Tauri requires it).
fn release_version(text: &str) -> Option<String> {
    let after_key = &text[text.find("\"version\"")? + "\"version\"".len()..];
    let after_colon = after_key.trim_start().strip_prefix(':')?.trim_start();
    let value = after_colon.strip_prefix('"')?;
    let version = &value[..value.find('"')?];
    let plausible = !version.is_empty()
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    plausible.then(|| version.to_string())
}
