//! Local diagnostic milestones for release-candidate builds only.
//!
//! Callers must pass only command names, stages, durations, counts and status
//! metadata. Never pass command arguments, tokens, account data, response bodies,
//! proxy URLs, or arbitrary error messages which might contain those values.
//! This logger does not redact payloads; keeping them safe is the caller's duty.
//!
//! Stable/beta builds do not create or modify any diagnostic files. RC builds
//! retain at most a 1 MiB JSONL file and one equally bounded rotated backup.
//! Logging failures are silently ignored and must never interrupt application work.

use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};

const MAX_LOG_BYTES: u64 = 1024 * 1024;
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Only the exact first SemVer prerelease identifier `rc` enables diagnostics.
/// `rc.4` and `rc` qualify; stable, beta, `rc4` and `beta.rc` do not.
pub fn enabled_for_version(version: &str) -> bool {
    semver::Version::parse(version)
        .ok()
        .is_some_and(|version| version.pre.as_str().split('.').next() == Some("rc"))
}

/// Returns the diagnostic destination without creating directories or files.
pub fn log_path() -> PathBuf {
    crate::modules::config::store_dir()
        .join("diagnostics")
        .join("rc-debug.log")
}

/// Records one safe diagnostic milestone in an RC build, best effort.
///
/// `fields` must contain safe timing/status/stage/command metadata only: no
/// arguments, tokens, response contents, account data, proxies or raw errors.
/// Entries larger than the file budget are dropped instead of growing the log.
pub fn record(component: &str, event: &str, fields: Value) {
    let version = crate::modules::update::APP_VERSION;
    // Gate before resolving the destination or doing any filesystem work.
    if !enabled_for_version(version) {
        return;
    }
    let _ = record_at(&log_path(), version, component, event, fields);
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".1");
    PathBuf::from(name)
}

fn record_at(
    path: &Path,
    version: &str,
    component: &str,
    event: &str,
    fields: Value,
) -> io::Result<()> {
    if !enabled_for_version(version) {
        return Ok(());
    }
    let entry = json!({
        "timestamp": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        "version": version,
        "pid": std::process::id(),
        "component": component,
        "event": event,
        "details": fields,
    });
    let mut line = serde_json::to_vec(&entry)?;
    line.push(b'\n');
    if line.len() as u64 > MAX_LOG_BYTES {
        return Ok(());
    }

    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let existing_len = match std::fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error),
    };
    if existing_len.saturating_add(line.len() as u64) > MAX_LOG_BYTES {
        let backup = backup_path(path);
        match std::fs::remove_file(&backup) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        if existing_len <= MAX_LOG_BYTES {
            std::fs::rename(path, backup)?;
        } else {
            // Do not preserve an externally enlarged file as an oversized backup.
            std::fs::remove_file(path)?;
        }
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(&line)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            Self(
                std::env::temp_dir()
                    .join(format!("wb-switch-rc-diagnostics-{}", uuid::Uuid::new_v4())),
            )
        }

        fn log(&self) -> PathBuf {
            self.0.join("diagnostics").join("rc-debug.log")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn entries(path: &Path) -> Vec<Value> {
        std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn only_rc_versions_write_and_disabled_versions_leave_existing_files_untouched() {
        for version in ["0.2.0", "0.2.0-beta.1", "0.2.0-rc4", "0.2.0-beta.rc", "bad"] {
            let temp = TempDir::new();
            assert!(!enabled_for_version(version), "{version}");
            record_at(&temp.log(), version, "ipc", "received", json!({})).unwrap();
            assert!(!temp.0.exists(), "{version} created diagnostic directories");
        }
        for version in ["0.2.0-rc", "0.2.0-rc.4", "0.2.0-rc.4+build"] {
            assert!(enabled_for_version(version), "{version}");
        }
        let temp = TempDir::new();
        record_at(&temp.log(), "0.2.0-rc.4", "ipc", "received", json!({})).unwrap();
        let before = std::fs::read(temp.log()).unwrap();
        record_at(&temp.log(), "0.2.0-beta.1", "ipc", "received", json!({})).unwrap();
        assert_eq!(std::fs::read(temp.log()).unwrap(), before);
        assert!(!backup_path(&temp.log()).exists());
    }

    #[test]
    fn entries_have_utc_time_and_only_the_documented_envelope() {
        let temp = TempDir::new();
        record_at(
            &temp.log(),
            "0.2.0-rc.4",
            "update",
            "completed",
            json!({"elapsedMs": 707, "ok": true}),
        )
        .unwrap();
        let rows = entries(&temp.log());
        let entry = &rows[0];
        assert_eq!(entry.as_object().unwrap().len(), 6);
        let timestamp = entry["timestamp"].as_str().unwrap();
        assert!(timestamp.ends_with('Z'));
        assert!(chrono::DateTime::parse_from_rfc3339(timestamp).is_ok());
        assert_eq!(entry["version"], "0.2.0-rc.4");
        assert_eq!(entry["pid"], std::process::id());
        assert_eq!(entry["component"], "update");
        assert_eq!(entry["event"], "completed");
        assert_eq!(entry["details"], json!({"elapsedMs": 707, "ok": true}));
    }

    #[test]
    fn rotation_keeps_only_two_bounded_jsonl_files_and_latest_records() {
        let temp = TempDir::new();
        let padding = "x".repeat(550_000);
        for index in 1..=3 {
            record_at(
                &temp.log(),
                "0.2.0-rc.4",
                "test",
                "rotation",
                json!({"index": index, "padding": padding}),
            )
            .unwrap();
        }
        let backup = backup_path(&temp.log());
        assert!(std::fs::metadata(temp.log()).unwrap().len() <= MAX_LOG_BYTES);
        assert!(std::fs::metadata(&backup).unwrap().len() <= MAX_LOG_BYTES);
        assert_eq!(entries(&temp.log())[0]["details"]["index"], 3);
        assert_eq!(entries(&backup)[0]["details"]["index"], 2);
        assert_eq!(
            std::fs::read_dir(temp.log().parent().unwrap())
                .unwrap()
                .count(),
            2
        );
    }

    #[test]
    fn oversized_entries_do_not_create_files_and_io_errors_are_returned() {
        let temp = TempDir::new();
        record_at(
            &temp.log(),
            "0.2.0-rc.4",
            "test",
            "oversized",
            json!({"padding": "x".repeat(MAX_LOG_BYTES as usize)}),
        )
        .unwrap();
        assert!(!temp.0.exists());
        std::fs::create_dir_all(&temp.0).unwrap();
        let blocker = temp.0.join("blocker");
        std::fs::write(&blocker, b"file").unwrap();
        assert!(record_at(
            &blocker.join("rc-debug.log"),
            "0.2.0-rc.4",
            "test",
            "blocked",
            json!({})
        )
        .is_err());
    }

    #[test]
    fn concurrent_callers_preserve_complete_json_lines() {
        let temp = TempDir::new();
        std::thread::scope(|scope| {
            for worker in 0..8 {
                let path = temp.log();
                scope.spawn(move || {
                    for index in 0..20 {
                        record_at(
                            &path,
                            "0.2.0-rc.4",
                            "ipc",
                            "received",
                            json!({"worker": worker, "index": index}),
                        )
                        .unwrap();
                    }
                });
            }
        });
        assert_eq!(entries(&temp.log()).len(), 160);
    }
}
