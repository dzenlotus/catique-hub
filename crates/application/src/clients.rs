//! Connected-clients use case (ctq-67).
//!
//! Orchestrates the adapter scan (`catique-clients`), registry
//! persistence (`catique-infrastructure::clients::registry`), and
//! `AppError` mapping so the IPC handler stays thin.
//!
//! There is no SQLite involvement — state lives in
//! `~/.catique-hub/connected-clients.json`.

use std::path::PathBuf;

use catique_clients::{all_adapters, ClientAdapter};
use catique_domain::ConnectedClient;
use catique_infrastructure::clients::{registry, RegistryError};

use crate::error::AppError;

/// All errors produced by the registry are mapped to `AppError::TransactionRolledBack`
/// (the closest semantic match for a storage operation failure that
/// doesn't involve SQLite). The `reason` field surfaces the underlying
/// OS/JSON message for observability without leaking sensitive paths.
fn map_registry_err(err: &RegistryError) -> AppError {
    AppError::TransactionRolledBack {
        reason: err.to_string(),
    }
}

/// Load from a specific path (production path when `None`).
fn load_from(path: Option<&PathBuf>) -> Result<Vec<ConnectedClient>, RegistryError> {
    match path {
        None => registry::load(),
        Some(p) => {
            if !p.exists() {
                return Ok(Vec::new());
            }
            let raw = std::fs::read_to_string(p).map_err(RegistryError::Io)?;
            serde_json::from_str(&raw).map_err(RegistryError::Json)
        }
    }
}

/// Save to a specific path (production path when `None`).
fn save_to(path: Option<&PathBuf>, clients: &[ConnectedClient]) -> Result<(), RegistryError> {
    match path {
        None => registry::save(clients),
        Some(p) => {
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(RegistryError::Io)?;
            }
            let json = serde_json::to_string_pretty(clients).map_err(RegistryError::Json)?;
            let tmp = p.with_extension("json.tmp");
            std::fs::write(&tmp, &json).map_err(RegistryError::Io)?;
            std::fs::rename(&tmp, p).map_err(RegistryError::Io)?;
            Ok(())
        }
    }
}

/// Connected-clients use case.
///
/// The `registry_path` field is `None` in production (uses
/// `~/.catique-hub/connected-clients.json`) and set to a temp path in
/// tests to avoid shared-state contention.
pub struct ClientsUseCase {
    adapters: Vec<Box<dyn ClientAdapter>>,
    /// Override registry path. `None` → production default.
    registry_path: Option<PathBuf>,
}

impl ClientsUseCase {
    /// Construct with the production adapter set and the default
    /// registry path (`~/.catique-hub/connected-clients.json`).
    #[must_use]
    pub fn new() -> Self {
        Self {
            adapters: all_adapters(),
            registry_path: None,
        }
    }

    /// Construct with a custom adapter set (for tests).
    #[must_use]
    pub fn with_adapters(adapters: Vec<Box<dyn ClientAdapter>>) -> Self {
        Self {
            adapters,
            registry_path: None,
        }
    }

    /// Override the registry file path (for tests to avoid writing to
    /// the developer's real home directory).
    #[must_use]
    pub fn with_registry_path(mut self, path: PathBuf) -> Self {
        self.registry_path = Some(path);
        self
    }

    /// Scan the filesystem for installed clients, persist the merged
    /// state, and return the new list.
    ///
    /// # Errors
    ///
    /// - Registry load/save failures → `AppError::TransactionRolledBack`.
    pub fn discover(&self) -> Result<Vec<ConnectedClient>, AppError> {
        let existing = load_from(self.registry_path.as_ref()).map_err(|e| map_registry_err(&e))?;
        let merged = registry::rescan(&self.adapters, &existing);
        save_to(self.registry_path.as_ref(), &merged).map_err(|e| map_registry_err(&e))?;
        Ok(merged)
    }

    /// Load the persisted registry from disk without rescanning.
    ///
    /// Returns an empty list on first run (no file yet).
    ///
    /// # Errors
    ///
    /// - Registry read failures → `AppError::TransactionRolledBack`.
    pub fn list(&self) -> Result<Vec<ConnectedClient>, AppError> {
        load_from(self.registry_path.as_ref()).map_err(|e| map_registry_err(&e))
    }

    /// Toggle the `enabled` flag for a specific client and persist the
    /// updated registry.
    ///
    /// # Errors
    ///
    /// - `AppError::NotFound` when `id` is not in the persisted registry.
    /// - Registry load/save failures → `AppError::TransactionRolledBack`.
    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<ConnectedClient, AppError> {
        let mut clients =
            load_from(self.registry_path.as_ref()).map_err(|e| map_registry_err(&e))?;

        let entry = clients
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::NotFound {
                entity: "connected_client".into(),
                id: id.to_owned(),
            })?;

        entry.enabled = enabled;
        let updated = entry.clone();

        save_to(self.registry_path.as_ref(), &clients).map_err(|e| map_registry_err(&e))?;

        Ok(updated)
    }
}

impl Default for ClientsUseCase {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_clients::AdapterError;
    use tempfile::TempDir;

    struct StubAdapter {
        id: &'static str,
        detected: bool,
    }

    impl ClientAdapter for StubAdapter {
        fn id(&self) -> &'static str {
            self.id
        }
        fn display_name(&self) -> &'static str {
            self.id
        }
        fn config_dir(&self) -> Result<PathBuf, AdapterError> {
            Ok(PathBuf::from(format!("/home/test/.{}", self.id)))
        }
        fn signature_file(&self) -> Result<PathBuf, AdapterError> {
            Ok(PathBuf::from(format!("/home/test/.{}/s.json", self.id)))
        }
        fn detect(&self) -> Result<bool, AdapterError> {
            Ok(self.detected)
        }
    }

    fn stub(id: &'static str, detected: bool) -> Box<dyn ClientAdapter> {
        Box::new(StubAdapter { id, detected })
    }

    /// Returns a `ClientsUseCase` wired to a temp registry file.
    /// The `TempDir` must be kept alive for the duration of the test.
    fn fresh_use_case(
        tmp: &TempDir,
        adapters: Vec<Box<dyn ClientAdapter>>,
    ) -> ClientsUseCase {
        let path = tmp.path().join("connected-clients.json");
        ClientsUseCase::with_adapters(adapters).with_registry_path(path)
    }

    #[test]
    fn discover_returns_all_adapters() {
        let tmp = TempDir::new().unwrap();
        let uc = fresh_use_case(&tmp, vec![stub("alpha", false), stub("beta", false)]);
        let result = uc.discover().expect("discover failed");
        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|c| c.id == "alpha"));
        assert!(result.iter().any(|c| c.id == "beta"));
    }

    #[test]
    fn list_returns_empty_when_registry_absent() {
        let tmp = TempDir::new().unwrap();
        let uc = fresh_use_case(&tmp, vec![]);
        let result = uc.list().expect("list failed");
        assert!(result.is_empty());
    }

    #[test]
    fn set_enabled_returns_not_found_for_unknown_id() {
        let tmp = TempDir::new().unwrap();
        let uc = fresh_use_case(&tmp, vec![]);
        // Registry is empty; any id should return NotFound.
        let err = uc
            .set_enabled("ghost-client", true)
            .expect_err("should be NotFound");
        match err {
            AppError::NotFound { entity, .. } => {
                assert_eq!(entity, "connected_client");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn discover_then_set_enabled_toggle() {
        let tmp = TempDir::new().unwrap();
        let uc = fresh_use_case(&tmp, vec![stub("togglable", false)]);

        let clients = uc.discover().expect("discover");
        let c = clients.iter().find(|c| c.id == "togglable").unwrap();
        // Initially not installed → enabled defaults to false.
        assert!(!c.enabled);

        // Force-enable via set_enabled.
        let updated = uc.set_enabled("togglable", true).expect("set_enabled");
        assert!(updated.enabled);
        assert_eq!(updated.id, "togglable");

        // Verify persistence: list() should see the updated value.
        let listed = uc.list().expect("list");
        let fresh = listed.iter().find(|c| c.id == "togglable").unwrap();
        assert!(fresh.enabled);
    }

    #[test]
    fn discover_defaults_enabled_to_installed() {
        let tmp = TempDir::new().unwrap();
        let uc =
            fresh_use_case(&tmp, vec![stub("installed", true), stub("missing", false)]);
        let clients = uc.discover().expect("discover");
        let installed = clients.iter().find(|c| c.id == "installed").unwrap();
        let missing = clients.iter().find(|c| c.id == "missing").unwrap();
        assert!(installed.enabled, "installed client should default to enabled");
        assert!(!missing.enabled, "absent client should default to disabled");
    }
}
