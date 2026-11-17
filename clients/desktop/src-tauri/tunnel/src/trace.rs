//! Step timings for connect and disconnect, written to a small local log so a
//! slow platform can be diagnosed from a user's machine.
//!
//! What is written is deliberately minimal — one line per operation with the
//! step NAMES and how many milliseconds each took, and whether it succeeded:
//!
//! ```text
//! 1794880544 connect ok total=15234ms wait_lock=0 teardown_previous=3 kill_switch=1 ...
//! ```
//!
//! No addresses, no keys, no hostnames, no error text: CumulusVPN keeps no
//! logs of what anyone does, and this stays on the user's own machine.
//!
//! Off unless the helper daemon turns it on ([`enable`]) at startup, so unit
//! tests and the in-process fallback write nothing. The file is capped at
//! [`MAX_BYTES`]; past that it is moved to `<name>.1` and started afresh.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

static LOG: OnceLock<PathBuf> = OnceLock::new();

/// Where the log rotates. A few thousand connects; plenty to diagnose with.
pub const MAX_BYTES: u64 = 256 * 1024;

/// The platform's log location for the helper daemon.
pub fn default_log_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("ProgramData")
            .map(|p| PathBuf::from(p).join("CumulusVPN").join("helper.log"))
    }
    #[cfg(target_os = "macos")]
    {
        Some(PathBuf::from("/Library/Logs/CumulusVPN/helper.log"))
    }
    #[cfg(target_os = "linux")]
    {
        Some(PathBuf::from("/var/log/cumulusvpn-helper.log"))
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

/// Turn the log on. Called once by the helper at startup; later calls are
/// ignored. A directory that cannot be created simply means nothing is logged.
pub fn enable(path: PathBuf) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = LOG.set(path);
}

/// One free-form line ("helper started", …). Callers pass fixed text only.
pub fn note(text: &str) {
    write_line(&format!("{} {text}", epoch_secs()));
}

fn epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn write_line(line: &str) {
    let Some(path) = LOG.get() else {
        return;
    };
    if fs::metadata(path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let mut old = path.clone().into_os_string();
        old.push(".1");
        let _ = fs::rename(path, PathBuf::from(old));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

/// The text of one operation's line. Pure, so the format is tested.
fn format_line(
    epoch: u64,
    op: &str,
    ok: bool,
    total_ms: u128,
    parts: &[(&'static str, u128)],
) -> String {
    let mut line = format!(
        "{epoch} {op} {} total={total_ms}ms",
        if ok { "ok" } else { "error" }
    );
    for (name, ms) in parts {
        line.push_str(&format!(" {name}={ms}"));
    }
    line
}

/// Times the steps of one connect or disconnect. Call [`Steps::mark`] after
/// each step and [`Steps::ok`] on success; dropped without `ok` (an early
/// `return Err` or `?`) it records the operation as an error, with the steps
/// it got through — which is where it failed.
pub struct Steps {
    op: &'static str,
    start: Instant,
    last: Instant,
    parts: Vec<(&'static str, u128)>,
    done: bool,
}

impl Steps {
    pub fn new(op: &'static str) -> Self {
        let now = Instant::now();
        Steps {
            op,
            start: now,
            last: now,
            parts: Vec::new(),
            done: false,
        }
    }

    /// The step that just finished, and how long it took since the last mark.
    pub fn mark(&mut self, name: &'static str) {
        let now = Instant::now();
        self.parts
            .push((name, now.duration_since(self.last).as_millis()));
        self.last = now;
    }

    pub fn ok(mut self) {
        self.write(true);
        self.done = true;
    }

    fn write(&self, ok: bool) {
        if LOG.get().is_none() {
            return;
        }
        write_line(&format_line(
            epoch_secs(),
            self.op,
            ok,
            self.start.elapsed().as_millis(),
            &self.parts,
        ));
    }
}

impl Drop for Steps {
    fn drop(&mut self) {
        if !self.done {
            self.write(false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_is_names_and_milliseconds_only() {
        let line = format_line(
            1_794_880_544,
            "connect",
            true,
            15_234,
            &[("sidecar_start", 3021), ("dns", 6000)],
        );
        assert_eq!(
            line,
            "1794880544 connect ok total=15234ms sidecar_start=3021 dns=6000"
        );
    }

    #[test]
    fn a_failed_operation_says_error() {
        let line = format_line(1, "disconnect", false, 5, &[]);
        assert_eq!(line, "1 disconnect error total=5ms");
    }

    /// Without `enable`, timing is free and writes nothing (tests, the
    /// in-process fallback).
    #[test]
    fn disabled_steps_write_nothing_and_do_not_panic() {
        let mut s = Steps::new("connect");
        s.mark("one");
        s.ok();
        let mut e = Steps::new("disconnect");
        e.mark("two");
        drop(e);
    }
}
