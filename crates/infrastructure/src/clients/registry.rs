//! Connected-clients registry — JSON-on-disk persistence (ctq-67).
//!
//! The registry lives at `~/.catique-hub/connected-clients.json`.
//! It deliberately uses a separate dotfile (`~/.catique-hub/`) rather
//! than the main `$APPLOCALDATA/catique/` tree so it stays readable by
//! external tooling and survives data-directory wipes.
//!
//! ## Atomic writes
//!
//! Saves are done via write-to-temp + rename, which is atomic on POSIX
//! filesystems. This prevents a half-written file from corrupting the
//! registry on crashes.
//!
//! ## Merge semantics
//!
//! `rescan` merges new scan results with the persisted state: if a
//! client was already in the registry its `enabled` flag is preserved
//! (user choice). Newly-detected clients default to `enabled = installed`.
//! Clients that are no longer detected remain in the registry with
//! `installed = false` so the user can see they were previously present.

use std::path::PathBuf;

use catique_domain::ConnectedClient;

use crate::clients::error::RegistryError;
use catique_clients::ClientAdapter;

/// Returns the path to the catique-hub dotfile directory.
///
/// # Errors
///
/// [`RegistryError::HomeDirUnavailable`] when `dirs::home_dir()` is
/// `None`.
pub fn registry_dir() -> Result<PathBuf, RegistryError> {
    let home = dirs::home_dir().ok_or(RegistryError::HomeDirUnavailable)?;
    Ok(home.join(".catique-hub"))
}

/// Returns the full path to the registry JSON file.
///
/// # Errors
///
/// Propagates [`registry_dir`]'s error.
pub fn registry_path() -> Result<PathBuf, RegistryError> {
    Ok(registry_dir()?.join("connected-clients.json"))
}

/// Load the registry from disk.
///
/// Returns an empty `Vec` when the file does not exist (first run).
///
/// # Errors
///
/// - [`RegistryError::Io`] on read failures.
/// - [`RegistryError::Json`] on deserialization failures.
pub fn load() -> Result<Vec<ConnectedClient>, RegistryError> {
    let path = registry_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(RegistryError::Io)?;
    let clients: Vec<ConnectedClient> = serde_json::from_str(&raw).map_err(RegistryError::Json)?;
    Ok(clients)
}

/// Save the registry to disk atomically.
///
/// Writes to `<path>.tmp` first, then renames to `<path>`. Creates the
/// parent directory (`~/.catique-hub/`) if it is absent.
///
/// # Errors
///
/// - [`RegistryError::Io`] on write or rename failures.
/// - [`RegistryError::Json`] on serialization failures.
pub fn save(clients: &[ConnectedClient]) -> Result<(), RegistryError> {
    let path = registry_path()?;

    // Ensure the config dir exists.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(RegistryError::Io)?;
    }

    let json = serde_json::to_string_pretty(clients).map_err(RegistryError::Json)?;

    // Atomic write: write to a sibling .tmp file, then rename.
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json).map_err(RegistryError::Io)?;
    std::fs::rename(&tmp_path, &path).map_err(RegistryError::Io)?;

    Ok(())
}

/// Run every adapter, build new state, merge with existing registry, and
/// return the merged list. Does **not** persist — callers decide whether
/// to call [`save`].
///
/// ## Merge rules
///
/// 1. Newly-detected clients (not in existing registry): `enabled` is set
///    to the `installed` value (enabled by default if present).
/// 2. Previously-known clients: `enabled` is preserved from the existing
///    entry (user override respected).
/// 3. Previously-known clients that are no longer detected: `installed`
///    is updated to `false`, `enabled` is preserved (user might want to
///    re-enable manually after reinstalling), `last_seen_at` is updated
///    to reflect the scan timestamp.
#[must_use]
pub fn rescan(
    adapters: &[Box<dyn ClientAdapter>],
    existing: &[ConnectedClient],
) -> Vec<ConnectedClient> {
    use std::collections::HashMap;

    let now_ms = now_unix_millis();

    // Index existing entries by id for O(1) lookup.
    let existing_map: HashMap<&str, &ConnectedClient> =
        existing.iter().map(|c| (c.id.as_str(), c)).collect();

    // Track which ids we processed so we can detect newly-added adapters.
    let mut processed_ids: std::collections::HashSet<&str> = std::collections::HashSet::new();

    let mut result: Vec<ConnectedClient> = adapters
        .iter()
        .map(|adapter| {
            let id = adapter.id();
            processed_ids.insert(id);

            let installed = adapter.detect().unwrap_or(false);

            let config_dir = adapter
                .config_dir()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();

            let signature_file = adapter
                .signature_file()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();

            // Preserve the user's `enabled` toggle if the client was
            // already known; otherwise default to `installed`.
            let enabled = existing_map.get(id).map_or(installed, |prev| prev.enabled);

            ConnectedClient {
                id: id.to_owned(),
                display_name: adapter.display_name().to_owned(),
                config_dir,
                signature_file,
                installed,
                enabled,
                last_seen_at: now_ms,
                supports_role_sync: adapter.supports_role_sync(),
            }
        })
        .collect();

    // Append previously-known clients whose adapter is no longer in the
    // current adapter set (shouldn't happen in v1 but guards future
    // adapter removals). Keep `supports_role_sync` from the existing
    // record — we no longer have the adapter to re-query it.
    for prev in existing {
        if !processed_ids.contains(prev.id.as_str()) {
            result.push(ConnectedClient {
                installed: false,
                last_seen_at: now_ms,
                ..prev.clone()
            });
        }
    }

    result
}

/// Current wall time as Unix milliseconds.
fn now_unix_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_clients::AdapterError;
    use std::path::PathBuf;

    // ---------------------------------------------------------------------------
    // Stub adapter used by merge tests — no filesystem reads.
    // ---------------------------------------------------------------------------

    struct StubAdapter {
        id: &'static str,
        display_name: &'static str,
        detected: bool,
    }

    impl ClientAdapter for StubAdapter {
        fn id(&self) -> &'static str {
            self.id
        }
        fn display_name(&self) -> &'static str {
            self.display_name
        }
        fn config_dir(&self) -> Result<PathBuf, AdapterError> {
            Ok(PathBuf::from(format!("/home/test/.{}", self.id)))
        }
        fn signature_file(&self) -> Result<PathBuf, AdapterError> {
            Ok(PathBuf::from(format!(
                "/home/test/.{}/settings.json",
                self.id
            )))
        }
        fn instructions_file(&self) -> Result<PathBuf, AdapterError> {
            Ok(PathBuf::from(format!(
                "/home/test/.{}/INSTRUCTIONS.md",
                self.id
            )))
        }
        fn detect(&self) -> Result<bool, AdapterError> {
            Ok(self.detected)
        }
        fn supports_role_sync(&self) -> bool {
            false
        }
        fn agents_dir(&self) -> Result<PathBuf, AdapterError> {
            Err(AdapterError::SyncNotSupported)
        }
        fn agent_filename(&self, _role_id: &str) -> String {
            String::new()
        }
    }

    fn stub(id: &'static str, detected: bool) -> Box<dyn ClientAdapter> {
        Box::new(StubAdapter {
            id,
            display_name: id,
            detected,
        })
    }

    // ---------------------------------------------------------------------------
    // merge / rescan tests
    // ---------------------------------------------------------------------------

    #[test]
    fn rescan_marks_detected_clients_as_installed() {
        let adapters: Vec<Box<dyn ClientAdapter>> = vec![stub("a", true), stub("b", false)];
        let result = rescan(&adapters, &[]);
        let a = result.iter().find(|c| c.id == "a").unwrap();
        let b = result.iter().find(|c| c.id == "b").unwrap();
        assert!(a.installed);
        assert!(!b.installed);
    }

    #[test]
    fn rescan_defaults_enabled_to_installed_for_new_clients() {
        let adapters: Vec<Box<dyn ClientAdapter>> = vec![stub("a", true), stub("b", false)];
        let result = rescan(&adapters, &[]);
        let a = result.iter().find(|c| c.id == "a").unwrap();
        let b = result.iter().find(|c| c.id == "b").unwrap();
        // enabled mirrors installed on first scan
        assert!(a.enabled);
        assert!(!b.enabled);
    }

    #[test]
    fn rescan_preserves_user_enabled_toggle_on_rescan() {
        // User explicitly disabled "a" even though it's installed.
        let existing = vec![ConnectedClient {
            id: "a".into(),
            display_name: "a".into(),
            config_dir: "/home/test/.a".into(),
            signature_file: "/home/test/.a/settings.json".into(),
            installed: true,
            enabled: false, // user override
            last_seen_at: 0,
            supports_role_sync: false,
        }];
        let adapters: Vec<Box<dyn ClientAdapter>> = vec![stub("a", true)];
        let result = rescan(&adapters, &existing);
        let a = result.iter().find(|c| c.id == "a").unwrap();
        assert!(a.installed);
        assert!(!a.enabled, "user override must be preserved");
    }

    #[test]
    fn rescan_marks_previously_known_but_now_absent_adapter_as_not_installed() {
        // "legacy" was in the existing registry but no adapter exists for it.
        let existing = vec![ConnectedClient {
            id: "legacy".into(),
            display_name: "Legacy Tool".into(),
            config_dir: "/home/test/.legacy".into(),
            signature_file: "/home/test/.legacy/s.json".into(),
            installed: true,
            enabled: true,
            last_seen_at: 0,
            supports_role_sync: false,
        }];
        let adapters: Vec<Box<dyn ClientAdapter>> = vec![stub("new-tool", true)];
        let result = rescan(&adapters, &existing);
        // Both entries should be present.
        assert_eq!(result.len(), 2);
        let legacy = result.iter().find(|c| c.id == "legacy").unwrap();
        assert!(
            !legacy.installed,
            "orphaned client should be marked not installed"
        );
        assert!(legacy.enabled, "user choice preserved");
    }

    // ---------------------------------------------------------------------------
    // save + load round-trip test
    // ---------------------------------------------------------------------------

    #[test]
    fn save_and_load_roundtrip() {
        use tempfile::TempDir;

        // We can't redirect registry_path() easily without env tricks, so we
        // test the JSON serialization shape directly.
        let clients = vec![ConnectedClient {
            id: "cursor".into(),
            display_name: "Cursor".into(),
            config_dir: "/Users/test/.cursor".into(),
            signature_file: "/Users/test/.cursor/mcp.json".into(),
            installed: true,
            enabled: true,
            last_seen_at: 1_700_000_000_000,
            supports_role_sync: true,
        }];

        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("connected-clients.json");

        // Serialise directly (bypassing the registry_path() singleton).
        let json = serde_json::to_string_pretty(&clients).unwrap();
        std::fs::write(&path, &json).unwrap();

        let loaded: Vec<ConnectedClient> =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "cursor");
        assert!(loaded[0].installed);
    }
}
