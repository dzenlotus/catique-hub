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
use catique_domain::{ClientInstructions, ConnectedClient};
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

    // ── Instructions helpers ────────────────────────────────────────────────

    /// Find an adapter by client id or return `AppError::NotFound`.
    fn adapter_by_id(&self, client_id: &str) -> Result<&dyn ClientAdapter, AppError> {
        self.adapters
            .iter()
            .find(|a| a.id() == client_id)
            .map(std::convert::AsRef::as_ref)
            .ok_or_else(|| AppError::NotFound {
                entity: "connected_client".into(),
                id: client_id.to_owned(),
            })
    }

    /// Read the global instructions file for a client.
    ///
    /// Returns empty content with `exists = false` when the file is absent
    /// on disk — absence is not an error. Returns `AppError::NotFound` when
    /// the `client_id` is unknown to the adapter registry.
    ///
    /// # Errors
    ///
    /// - `AppError::NotFound` — unknown `client_id`.
    /// - `AppError::TransactionRolledBack` — home dir unavailable or I/O
    ///   failure while reading an existing file.
    pub fn read_instructions(&self, client_id: &str) -> Result<ClientInstructions, AppError> {
        let adapter = self.adapter_by_id(client_id)?;
        let path = adapter
            .instructions_file()
            .map_err(|e| AppError::TransactionRolledBack { reason: e.to_string() })?;

        if !path.exists() {
            return Ok(ClientInstructions {
                client_id: client_id.to_owned(),
                file_path: path.to_string_lossy().into_owned(),
                content: String::new(),
                modified_at: 0,
                exists: false,
            });
        }

        let content = std::fs::read_to_string(&path).map_err(|e| {
            AppError::TransactionRolledBack {
                reason: format!("read {}: {e}", path.display()),
            }
        })?;

        let modified_at: i64 = path
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|d| i64::try_from(d.as_millis()).ok())
            .unwrap_or(0);

        Ok(ClientInstructions {
            client_id: client_id.to_owned(),
            file_path: path.to_string_lossy().into_owned(),
            content,
            modified_at,
            exists: true,
        })
    }

    /// Atomically write the global instructions file for a client.
    ///
    /// Uses a `.tmp`-then-rename strategy for atomicity. Creates any
    /// missing parent directories inside the adapter's `config_dir()`.
    /// Returns the fresh `ClientInstructions` snapshot so the FE can
    /// update its cache without a second round-trip.
    ///
    /// # Errors
    ///
    /// - `AppError::NotFound` — unknown `client_id`.
    /// - `AppError::TransactionRolledBack` — home dir unavailable, failed
    ///   to create parent directories, or I/O error during write/rename.
    pub fn write_instructions(
        &self,
        client_id: &str,
        content: &str,
    ) -> Result<ClientInstructions, AppError> {
        let adapter = self.adapter_by_id(client_id)?;
        let path = adapter
            .instructions_file()
            .map_err(|e| AppError::TransactionRolledBack { reason: e.to_string() })?;

        // Ensure parent directory exists (it may not if the client was
        // never launched on this machine).
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::TransactionRolledBack {
                    reason: format!("create dirs {}: {e}", parent.display()),
                }
            })?;
        }

        // Atomic write: write to .tmp then rename.
        let tmp = path.with_extension("md.tmp");
        std::fs::write(&tmp, content).map_err(|e| AppError::TransactionRolledBack {
            reason: format!("write tmp {}: {e}", tmp.display()),
        })?;
        std::fs::rename(&tmp, &path).map_err(|e| AppError::TransactionRolledBack {
            reason: format!("rename tmp → {}: {e}", path.display()),
        })?;

        // Return fresh snapshot.
        self.read_instructions(client_id)
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
        /// Override config dir to a tempfile-backed path.
        config_dir_override: Option<PathBuf>,
    }

    impl ClientAdapter for StubAdapter {
        fn id(&self) -> &'static str {
            self.id
        }
        fn display_name(&self) -> &'static str {
            self.id
        }
        fn config_dir(&self) -> Result<PathBuf, AdapterError> {
            match &self.config_dir_override {
                Some(p) => Ok(p.clone()),
                None => Ok(PathBuf::from(format!("/home/test/.{}", self.id))),
            }
        }
        fn signature_file(&self) -> Result<PathBuf, AdapterError> {
            Ok(self.config_dir()?.join("s.json"))
        }
        fn instructions_file(&self) -> Result<PathBuf, AdapterError> {
            Ok(self.config_dir()?.join("INSTRUCTIONS.md"))
        }
        fn detect(&self) -> Result<bool, AdapterError> {
            Ok(self.detected)
        }
    }

    fn stub(id: &'static str, detected: bool) -> Box<dyn ClientAdapter> {
        Box::new(StubAdapter {
            id,
            detected,
            config_dir_override: None,
        })
    }

    /// Build a stub with a real filesystem-backed config dir (for
    /// instructions read/write tests).
    fn stub_with_dir(
        id: &'static str,
        config_dir: PathBuf,
    ) -> Box<dyn ClientAdapter> {
        Box::new(StubAdapter {
            id,
            detected: false,
            config_dir_override: Some(config_dir),
        })
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

    // ── Instructions tests ───────────────────────────────────────────────────

    /// Helper: build a use case with one stub whose config dir is a real
    /// temp dir. Returns both (so the TempDir stays alive).
    fn instructions_use_case(
        registry_tmp: &TempDir,
        client_id: &'static str,
        config_dir: PathBuf,
    ) -> ClientsUseCase {
        let registry_path = registry_tmp.path().join("reg.json");
        ClientsUseCase::with_adapters(vec![stub_with_dir(client_id, config_dir)])
            .with_registry_path(registry_path)
    }

    #[test]
    fn read_instructions_absent_file_returns_empty() {
        let reg_tmp = TempDir::new().unwrap();
        let cfg_tmp = TempDir::new().unwrap();
        // config dir exists but INSTRUCTIONS.md does not
        let uc = instructions_use_case(&reg_tmp, "myagent", cfg_tmp.path().to_path_buf());
        let result = uc.read_instructions("myagent").expect("read should succeed");
        assert_eq!(result.client_id, "myagent");
        assert_eq!(result.content, "");
        assert!(!result.exists);
        assert_eq!(result.modified_at, 0);
    }

    #[test]
    fn read_instructions_not_found_for_unknown_id() {
        let reg_tmp = TempDir::new().unwrap();
        let cfg_tmp = TempDir::new().unwrap();
        let uc = instructions_use_case(&reg_tmp, "myagent", cfg_tmp.path().to_path_buf());
        let err = uc
            .read_instructions("ghost")
            .expect_err("should be NotFound");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "connected_client"),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn write_then_read_round_trips_content() {
        let reg_tmp = TempDir::new().unwrap();
        let cfg_tmp = TempDir::new().unwrap();
        let config_dir = cfg_tmp.path().to_path_buf();
        let uc = instructions_use_case(&reg_tmp, "myagent", config_dir.clone());

        let content = "# Global instructions\n\nDo the right thing.";
        let written = uc
            .write_instructions("myagent", content)
            .expect("write should succeed");

        assert_eq!(written.client_id, "myagent");
        assert_eq!(written.content, content);
        assert!(written.exists);
        assert!(written.modified_at > 0);

        // Independent read also returns the same content.
        let read = uc.read_instructions("myagent").expect("read should succeed");
        assert_eq!(read.content, content);
        assert!(read.exists);
    }

    #[test]
    fn write_creates_parent_dirs() {
        let reg_tmp = TempDir::new().unwrap();
        let cfg_tmp = TempDir::new().unwrap();
        // Point the config dir to a *non-existent* subdirectory.
        let config_dir = cfg_tmp.path().join("nested").join("dirs");
        let uc = instructions_use_case(&reg_tmp, "myagent", config_dir.clone());

        uc.write_instructions("myagent", "hello")
            .expect("should create parent dirs and write");

        let file = config_dir.join("INSTRUCTIONS.md");
        assert!(file.exists(), "instructions file must be created");
        assert_eq!(std::fs::read_to_string(file).unwrap(), "hello");
    }

    #[test]
    fn write_overwrites_existing_content() {
        let reg_tmp = TempDir::new().unwrap();
        let cfg_tmp = TempDir::new().unwrap();
        let config_dir = cfg_tmp.path().to_path_buf();
        let uc = instructions_use_case(&reg_tmp, "myagent", config_dir.clone());

        uc.write_instructions("myagent", "first")
            .unwrap();
        let second = uc
            .write_instructions("myagent", "second")
            .unwrap();

        assert_eq!(second.content, "second");
        let file = config_dir.join("INSTRUCTIONS.md");
        assert_eq!(std::fs::read_to_string(file).unwrap(), "second");
    }

    #[test]
    fn write_not_found_for_unknown_id() {
        let reg_tmp = TempDir::new().unwrap();
        let cfg_tmp = TempDir::new().unwrap();
        let uc = instructions_use_case(&reg_tmp, "myagent", cfg_tmp.path().to_path_buf());
        let err = uc
            .write_instructions("ghost", "content")
            .expect_err("should be NotFound");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "connected_client"),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}
