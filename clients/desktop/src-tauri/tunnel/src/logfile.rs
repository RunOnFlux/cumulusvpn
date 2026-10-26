//! Size-capped log files: `desktop.log` (the app) and `helper.log` (the daemon
//! on Windows and macOS).
//!
//! A log that has reached [`MAX_LOG_BYTES`] becomes `<name>.1`, replacing any
//! older one, and writing continues in a fresh `<name>`. Each log therefore
//! holds at most about twice the cap on disk, and the newest lines are always
//! in `<name>`.

use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// Size at which a log moves to `<name>.1`.
pub const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// `<path>.1`: where a full log moves to.
pub fn rotated_path(path: &Path) -> PathBuf {
    let mut name = OsString::from(path.as_os_str());
    name.push(".1");
    PathBuf::from(name)
}

/// Whether the log at `path` has reached `max` bytes. A log that does not exist
/// has not.
pub fn is_full(path: &Path, max: u64) -> bool {
    fs::metadata(path).is_ok_and(|m| m.len() >= max)
}

/// Open `path` for appending, creating it. A log that has reached `max` bytes
/// first moves to [`rotated_path`]; the returned flag says whether it did.
pub fn open_capped(path: &Path, max: u64) -> io::Result<(File, bool)> {
    let rotated = is_full(path, max);
    if rotated {
        // Replaces an older `.1` (`rename` overwrites on every platform std
        // supports). A file still held open by its writer moves with it: Unix
        // keeps the inode, and Windows allows it because std opens files
        // shareable for delete.
        fs::rename(path, rotated_path(path))?;
    }
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    Ok((file, rotated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cumulusvpn-logfile-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("x.log")
    }

    #[test]
    fn a_log_under_the_cap_is_appended_to() {
        let path = scratch("under");
        fs::write(&path, b"one\n").unwrap();
        let (mut f, rotated) = open_capped(&path, 100).unwrap();
        writeln!(f, "two").unwrap();
        drop(f);
        assert!(!rotated);
        assert_eq!(fs::read_to_string(&path).unwrap(), "one\ntwo\n");
        assert!(!rotated_path(&path).exists());
    }

    #[test]
    fn a_full_log_moves_to_dot_1_and_a_fresh_one_starts() {
        let path = scratch("full");
        fs::write(&path, vec![b'a'; 100]).unwrap();
        let (mut f, rotated) = open_capped(&path, 100).unwrap();
        writeln!(f, "new").unwrap();
        drop(f);
        assert!(rotated);
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\n");
        assert_eq!(fs::read(rotated_path(&path)).unwrap().len(), 100);
    }

    #[test]
    fn rotating_again_replaces_the_older_dot_1() {
        let path = scratch("again");
        fs::write(rotated_path(&path), b"oldest").unwrap();
        fs::write(&path, vec![b'b'; 100]).unwrap();
        let (_f, rotated) = open_capped(&path, 100).unwrap();
        assert!(rotated);
        assert_eq!(fs::read(rotated_path(&path)).unwrap(), vec![b'b'; 100]);
    }

    #[test]
    fn a_log_held_open_by_its_writer_can_still_rotate() {
        let path = scratch("open");
        let (mut writer, _) = open_capped(&path, 100).unwrap();
        writer.write_all(&[b'c'; 100]).unwrap();
        let (mut fresh, rotated) = open_capped(&path, 100).unwrap();
        assert!(rotated);
        // The old writer keeps writing into the rotated file.
        writer.write_all(b"late").unwrap();
        fresh.write_all(b"fresh").unwrap();
        drop((writer, fresh));
        assert_eq!(fs::read(&path).unwrap(), b"fresh");
        assert!(fs::read(rotated_path(&path)).unwrap().ends_with(b"late"));
    }

    #[test]
    fn a_missing_log_is_not_full() {
        let path = scratch("missing");
        assert!(!is_full(&path, 1));
        assert_eq!(
            rotated_path(Path::new("a/helper.log")),
            Path::new("a/helper.log.1")
        );
    }
}
