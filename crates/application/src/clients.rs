//! Connected-clients use case (ctq-67 / ctq-69).
//!
//! Orchestrates the adapter scan (`catique-clients`), registry
//! persistence (`catique-infrastructure::clients::registry`), and
//! role-file sync (ctq-69). The `AppError` mapping keeps the IPC handler
//! thin.
//!
//! Role-file sync (ctq-69): one-way Catique Hub → client agent files.
//! Only files marked with `managed-by: catique-hub` frontmatter AND the
//! `catique-` filename prefix are considered managed. User-authored files
//! are never touched.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use catique_clients::{all_adapters, ClientAdapter};
use catique_domain::{ClientInstructions, ConnectedClient, RoleSyncReport, SyncedRoleFile};
use catique_infrastructure::clients::{registry, RegistryError};
use catique_infrastructure::db::pool::{acquire, Pool};

use crate::error::AppError;

// ── YAML frontmatter constants (ctq-69) ────────────────────────────────────

/// The `managed-by` value that marks a file as Catique-managed.
const MANAGED_BY_VALUE: &str = "catique-hub";

/// Prefix every managed filename must start with (after the `catique-`).
const CATIQUE_PREFIX: &str = "catique-";

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
///
/// The `pool` field is `None` by default; role-sync methods require it.
/// The IPC handler provides it from `AppState`.
pub struct ClientsUseCase {
    adapters: Vec<Box<dyn ClientAdapter>>,
    /// Override registry path. `None` → production default.
    registry_path: Option<PathBuf>,
    /// SQLite connection pool for role-sync DB reads.
    pool: Option<Pool>,
}

impl ClientsUseCase {
    /// Construct with the production adapter set and the default
    /// registry path (`~/.catique-hub/connected-clients.json`).
    #[must_use]
    pub fn new() -> Self {
        Self {
            adapters: all_adapters(),
            registry_path: None,
            pool: None,
        }
    }

    /// Construct with a custom adapter set (for tests).
    #[must_use]
    pub fn with_adapters(adapters: Vec<Box<dyn ClientAdapter>>) -> Self {
        Self {
            adapters,
            registry_path: None,
            pool: None,
        }
    }

    /// Override the registry file path (for tests to avoid writing to
    /// the developer's real home directory).
    #[must_use]
    pub fn with_registry_path(mut self, path: PathBuf) -> Self {
        self.registry_path = Some(path);
        self
    }

    /// Supply the SQLite pool needed by role-sync methods (ctq-69).
    ///
    /// `Pool` is `Clone` (Arc-backed), so cloning in the handler is cheap.
    #[must_use]
    pub fn with_pool(mut self, pool: Pool) -> Self {
        self.pool = Some(pool);
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

    // ── Role-sync methods (ctq-69) ─────────────────────────────────────────

    /// Scan the `agents_dir` for this client and return every file that
    /// is marked as Catique-managed (both filename prefix AND frontmatter
    /// `managed-by: catique-hub` must be present — defence-in-depth).
    ///
    /// Returns an empty list when the directory does not yet exist (no
    /// sync has run yet) rather than an error.
    ///
    /// # Errors
    ///
    /// - `AppError::NotFound` — unknown `client_id`.
    /// - `AppError::Validation` — client does not support role sync.
    /// - `AppError::TransactionRolledBack` — I/O failures while reading.
    pub fn list_synced_roles(&self, client_id: &str) -> Result<Vec<SyncedRoleFile>, AppError> {
        let adapter = self.adapter_by_id(client_id)?;
        if !adapter.supports_role_sync() {
            return Err(AppError::Validation {
                field: "client_id".into(),
                reason: format!("client '{client_id}' does not support role sync"),
            });
        }
        let agents_dir = adapter
            .agents_dir()
            .map_err(|e| AppError::TransactionRolledBack { reason: e.to_string() })?;

        if !agents_dir.exists() {
            return Ok(Vec::new());
        }

        let entries = std::fs::read_dir(&agents_dir).map_err(|e| {
            AppError::TransactionRolledBack {
                reason: format!("read dir {}: {e}", agents_dir.display()),
            }
        })?;

        let mut result = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let fname = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_owned();

            // Must have catique- prefix.
            if !fname.starts_with(CATIQUE_PREFIX) {
                continue;
            }

            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };

            // Parse frontmatter to confirm managed-by and extract role-id + synced-at.
            if let Some(fm) = parse_frontmatter(&content) {
                if fm.managed_by.as_deref() == Some(MANAGED_BY_VALUE) {
                    if let Some(role_id) = fm.role_id {
                        result.push(SyncedRoleFile {
                            client_id: client_id.to_owned(),
                            role_id,
                            file_path: path.to_string_lossy().into_owned(),
                            synced_at: fm.synced_at.unwrap_or(0),
                        });
                    }
                }
            }
        }

        Ok(result)
    }

    /// One-way sync: write every Catique Hub role to `agents_dir` for the
    /// given client. Deletes stale managed files; never touches
    /// user-authored files.
    ///
    /// # Algorithm
    ///
    /// 1. Validate adapter supports sync.
    /// 2. Resolve + create `agents_dir` if missing.
    /// 3. Fetch all roles from DB; for each role, fetch its attached prompts.
    /// 4. Render each role to a markdown file (frontmatter + body + prompts).
    /// 5. Scan existing managed files on disk; delete those whose role no
    ///    longer exists in Catique Hub.
    /// 6. Write new/updated files atomically (`.tmp` + rename).
    ///
    /// # Errors
    ///
    /// - `AppError::NotFound` — unknown `client_id`.
    /// - `AppError::Validation` — client does not support role sync, or no
    ///   pool was provided via `with_pool`.
    /// - `AppError::TransactionRolledBack` — I/O or DB failures.
    #[allow(clippy::too_many_lines)]
    pub fn sync_roles_to_client(&self, client_id: String) -> Result<RoleSyncReport, AppError> {
        let adapter = self.adapter_by_id(&client_id)?;
        if !adapter.supports_role_sync() {
            return Err(AppError::Validation {
                field: "client_id".into(),
                reason: format!("client '{client_id}' does not support role sync"),
            });
        }

        let pool = self.pool.as_ref().ok_or_else(|| AppError::Validation {
            field: "pool".into(),
            reason: "pool not provided to ClientsUseCase (use with_pool)".into(),
        })?;

        let agents_dir = adapter
            .agents_dir()
            .map_err(|e| AppError::TransactionRolledBack { reason: e.to_string() })?;

        std::fs::create_dir_all(&agents_dir).map_err(|e| {
            AppError::TransactionRolledBack {
                reason: format!("create dir {}: {e}", agents_dir.display()),
            }
        })?;

        let conn = acquire(pool).map_err(|e| AppError::TransactionRolledBack {
            reason: e.to_string(),
        })?;
        let roles = fetch_roles_with_prompts(&conn).map_err(|e| {
            AppError::TransactionRolledBack {
                reason: format!("fetch roles: {e}"),
            }
        })?;

        let ext = file_ext_for_adapter(adapter);
        let (on_disk_managed, skipped) =
            scan_agents_dir(&agents_dir).map_err(|e| AppError::TransactionRolledBack {
                reason: e,
            })?;

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
            .unwrap_or(0);

        let mut created: Vec<String> = Vec::new();
        let mut updated: Vec<String> = Vec::new();
        let mut written_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        for role_entry in &roles {
            let filename = adapter.agent_filename(&role_entry.role_id);
            let target = agents_dir.join(&filename);
            let body = render_role_file(role_entry, now_ms, ext);
            let tmp = target.with_extension(format!("{ext}.tmp"));
            std::fs::write(&tmp, &body).map_err(|e| AppError::TransactionRolledBack {
                reason: format!("write tmp {}: {e}", tmp.display()),
            })?;
            std::fs::rename(&tmp, &target).map_err(|e| {
                AppError::TransactionRolledBack {
                    reason: format!("rename {} → {}: {e}", tmp.display(), target.display()),
                }
            })?;
            if on_disk_managed.contains_key(&role_entry.role_id) {
                updated.push(role_entry.role_id.clone());
            } else {
                created.push(role_entry.role_id.clone());
            }
            written_ids.insert(role_entry.role_id.clone());
        }

        let deleted = delete_stale_managed_files(&on_disk_managed, &written_ids);

        Ok(RoleSyncReport { client_id, created, updated, deleted, skipped })
    }
}

// ── Internal helpers (ctq-69) ───────────────────────────────────────────────

/// Minimal YAML frontmatter fields we care about.
struct FrontmatterFields {
    managed_by: Option<String>,
    role_id: Option<String>,
    synced_at: Option<i64>,
}

/// Parse a hand-written YAML frontmatter block from a file's content.
///
/// The frontmatter must start with `---\n` on the first line and be
/// closed by a `---\n` or `---\r\n` line. We deliberately avoid adding
/// `serde_yaml` as a dep; the block has a fixed, known shape so a line
/// scan is sufficient and more robust than a full YAML parse.
fn parse_frontmatter(content: &str) -> Option<FrontmatterFields> {
    let mut lines = content.lines();
    // First line must be exactly `---`.
    if lines.next()?.trim() != "---" {
        return None;
    }

    let mut managed_by: Option<String> = None;
    let mut role_id: Option<String> = None;
    let mut synced_at: Option<i64> = None;

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if let Some(val) = trimmed.strip_prefix("managed-by:") {
            managed_by = Some(val.trim().to_owned());
        } else if let Some(val) = trimmed.strip_prefix("role-id:") {
            role_id = Some(val.trim().to_owned());
        } else if let Some(val) = trimmed.strip_prefix("synced-at:") {
            synced_at = val.trim().parse::<i64>().ok();
        }
    }

    Some(FrontmatterFields { managed_by, role_id, synced_at })
}

/// One role with its attached prompts fetched from the DB.
struct RoleEntry {
    role_id: String,
    role_name: String,
    role_content: String,
    role_color: Option<String>,
    prompts: Vec<AttachedPrompt>,
}

struct AttachedPrompt {
    name: String,
    content: String,
}

/// Fetch all roles and their attached prompts via the DB connection.
fn fetch_roles_with_prompts(
    conn: &rusqlite::Connection,
) -> Result<Vec<RoleEntry>, rusqlite::Error> {
    // Load roles first.
    let mut stmt = conn.prepare(
        "SELECT id, name, content, color FROM roles ORDER BY name ASC",
    )?;
    let role_rows: Vec<(String, String, String, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .filter_map(Result::ok)
        .collect();

    let mut entries = Vec::with_capacity(role_rows.len());
    for (id, name, content, color) in role_rows {
        // For each role, fetch attached prompts ordered by position.
        let mut pstmt = conn.prepare(
            "SELECT p.name, p.content \
             FROM role_prompts rp \
             JOIN prompts p ON p.id = rp.prompt_id \
             WHERE rp.role_id = ?1 \
             ORDER BY rp.position ASC",
        )?;
        let prompts: Vec<AttachedPrompt> = pstmt
            .query_map([&id], |row| {
                Ok(AttachedPrompt {
                    name: row.get(0)?,
                    content: row.get(1)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();

        entries.push(RoleEntry {
            role_id: id,
            role_name: name,
            role_content: content,
            role_color: color,
            prompts,
        });
    }
    Ok(entries)
}

/// Determine the file extension string (`"md"` or `"mdc"`) for an adapter.
fn file_ext_for_adapter(adapter: &dyn ClientAdapter) -> &'static str {
    let sample = adapter.agent_filename("x");
    if std::path::Path::new(&sample)
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("mdc"))
    {
        "mdc"
    } else {
        "md"
    }
}

/// Scan `agents_dir` and classify files as managed or skipped.
///
/// Returns `(on_disk_managed, skipped)` where:
/// - `on_disk_managed`: map of `role_id → PathBuf` for files that have
///   both the `catique-` prefix and valid managed frontmatter.
/// - `skipped`: filenames of all other files (not touched by sync).
fn scan_agents_dir(
    agents_dir: &std::path::Path,
) -> Result<(std::collections::HashMap<String, PathBuf>, Vec<String>), String> {
    let mut on_disk_managed = std::collections::HashMap::new();
    let mut skipped = Vec::new();

    if !agents_dir.exists() {
        return Ok((on_disk_managed, skipped));
    }

    let entries = std::fs::read_dir(agents_dir)
        .map_err(|e| format!("read dir {}: {e}", agents_dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let fname = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();

        if !fname.starts_with(CATIQUE_PREFIX) {
            skipped.push(fname);
            continue;
        }

        let Ok(content) = std::fs::read_to_string(&path) else {
            skipped.push(fname);
            continue;
        };

        if let Some(fm) = parse_frontmatter(&content) {
            if fm.managed_by.as_deref() == Some(MANAGED_BY_VALUE) {
                if let Some(role_id) = fm.role_id {
                    on_disk_managed.insert(role_id, path);
                    continue;
                }
            }
        }
        // catique- prefix but no valid managed frontmatter — treat as
        // user-authored (safety: never delete).
        skipped.push(fname);
    }

    Ok((on_disk_managed, skipped))
}

/// Delete managed files on disk whose role no longer exists in Catique Hub.
///
/// Returns the list of deleted role ids.
fn delete_stale_managed_files(
    on_disk_managed: &std::collections::HashMap<String, PathBuf>,
    written_ids: &std::collections::HashSet<String>,
) -> Vec<String> {
    let mut deleted = Vec::new();
    for (role_id, path) in on_disk_managed {
        if !written_ids.contains(role_id.as_str()) {
            if let Err(e) = std::fs::remove_file(path) {
                eprintln!("[catique-hub] sync: delete stale {}: {e}", path.display());
            } else {
                deleted.push(role_id.clone());
            }
        }
    }
    deleted
}

/// Render a role to a markdown file with YAML frontmatter.
///
/// Format:
/// ```text
/// ---
/// managed-by: catique-hub
/// role-id: <id>
/// role-name: "<name>"
/// synced-at: <unix-ms>
/// color: "<hex>"         # optional
/// ---
///
/// <role.content>
///
/// ## <prompt name>
///
/// <prompt content>
/// ```
fn render_role_file(entry: &RoleEntry, now_ms: i64, _ext: &str) -> String {
    use std::fmt::Write as _;

    let mut out = String::new();
    out.push_str("---\n");
    let _ = writeln!(out, "managed-by: {MANAGED_BY_VALUE}");
    let _ = writeln!(out, "role-id: {}", entry.role_id);
    // Escape double-quotes in role names so YAML stays valid.
    let safe_name = entry.role_name.replace('"', "\\\"");
    let _ = writeln!(out, "role-name: \"{safe_name}\"");
    let _ = writeln!(out, "synced-at: {now_ms}");
    if let Some(color) = &entry.role_color {
        let _ = writeln!(out, "color: \"{color}\"");
    }
    out.push_str("---\n");

    if !entry.role_content.is_empty() {
        out.push('\n');
        out.push_str(&entry.role_content);
    }

    for prompt in &entry.prompts {
        out.push_str("\n\n## ");
        out.push_str(&prompt.name);
        out.push_str("\n\n");
        out.push_str(&prompt.content);
    }

    out
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

    // ── Role-sync tests (ctq-69) ─────────────────────────────────────────────

    /// A sync-capable stub adapter backed by a real temp dir.
    struct SyncStubAdapter {
        id: &'static str,
        agents_dir: PathBuf,
        ext: &'static str,
    }

    impl ClientAdapter for SyncStubAdapter {
        fn id(&self) -> &'static str {
            self.id
        }
        fn display_name(&self) -> &'static str {
            self.id
        }
        fn config_dir(&self) -> Result<PathBuf, AdapterError> {
            Ok(self.agents_dir.parent().unwrap().to_path_buf())
        }
        fn signature_file(&self) -> Result<PathBuf, AdapterError> {
            Ok(self.config_dir()?.join("s.json"))
        }
        fn instructions_file(&self) -> Result<PathBuf, AdapterError> {
            Ok(self.config_dir()?.join("INSTRUCTIONS.md"))
        }
        fn detect(&self) -> Result<bool, AdapterError> {
            Ok(true)
        }
        fn supports_role_sync(&self) -> bool {
            true
        }
        fn agents_dir(&self) -> Result<PathBuf, AdapterError> {
            Ok(self.agents_dir.clone())
        }
        fn agent_filename(&self, role_id: &str) -> String {
            format!("catique-{role_id}.{}", self.ext)
        }
    }

    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_sync_pool() -> catique_infrastructure::db::pool::Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        drop(conn);
        pool
    }

    fn sync_use_case(
        reg_tmp: &TempDir,
        agents_dir: PathBuf,
        pool: catique_infrastructure::db::pool::Pool,
    ) -> ClientsUseCase {
        let reg_path = reg_tmp.path().join("reg.json");
        let adapter: Box<dyn ClientAdapter> = Box::new(SyncStubAdapter {
            id: "test-client",
            agents_dir,
            ext: "md",
        });
        ClientsUseCase::with_adapters(vec![adapter])
            .with_registry_path(reg_path)
            .with_pool(pool)
    }

    #[test]
    fn sync_roles_creates_files_and_returns_report() {
        let reg_tmp = TempDir::new().unwrap();
        let agents_tmp = TempDir::new().unwrap();
        let agents_dir = agents_tmp.path().join("agents");
        let pool = fresh_sync_pool();

        // Insert a role into the DB.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, color, created_at, updated_at) \
                 VALUES ('role-1', 'Backend', 'You are a backend engineer.', '#ff0000', 0, 0)",
                [],
            )
            .unwrap();
        }

        let uc = sync_use_case(&reg_tmp, agents_dir.clone(), pool);
        let report = uc
            .sync_roles_to_client("test-client".into())
            .expect("sync should succeed");

        assert_eq!(report.client_id, "test-client");
        assert_eq!(report.created, vec!["role-1"]);
        assert!(report.updated.is_empty());
        assert!(report.deleted.is_empty());

        let file = agents_dir.join("catique-role-1.md");
        assert!(file.exists(), "agent file must be created");
        let content = std::fs::read_to_string(&file).unwrap();
        assert!(content.contains("managed-by: catique-hub"));
        assert!(content.contains("role-id: role-1"));
        assert!(content.contains("You are a backend engineer."));
    }

    #[test]
    fn sync_roles_with_attached_prompts() {
        let reg_tmp = TempDir::new().unwrap();
        let agents_tmp = TempDir::new().unwrap();
        let agents_dir = agents_tmp.path().join("agents");
        let pool = fresh_sync_pool();

        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, color, created_at, updated_at) \
                 VALUES ('r2', 'Frontend', 'FE role', NULL, 0, 0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO prompts (id, name, content, created_at, updated_at) \
                 VALUES ('p1', 'Code Style', 'Use tabs.', 0, 0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO role_prompts (role_id, prompt_id, position) VALUES ('r2', 'p1', 1.0)",
                [],
            )
            .unwrap();
        }

        let uc = sync_use_case(&reg_tmp, agents_dir.clone(), pool);
        uc.sync_roles_to_client("test-client".into()).unwrap();

        let content = std::fs::read_to_string(agents_dir.join("catique-r2.md")).unwrap();
        assert!(content.contains("## Code Style"));
        assert!(content.contains("Use tabs."));
    }

    #[test]
    fn sync_roles_deletes_stale_managed_files() {
        let reg_tmp = TempDir::new().unwrap();
        let agents_tmp = TempDir::new().unwrap();
        let agents_dir = agents_tmp.path().join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        let pool = fresh_sync_pool();

        // Write a stale managed file (role "old-role" no longer in DB).
        let stale_path = agents_dir.join("catique-old-role.md");
        std::fs::write(
            &stale_path,
            "---\nmanaged-by: catique-hub\nrole-id: old-role\nsynced-at: 0\n---\nOld content.",
        )
        .unwrap();

        let uc = sync_use_case(&reg_tmp, agents_dir.clone(), pool);
        let report = uc.sync_roles_to_client("test-client".into()).unwrap();

        assert!(
            report.deleted.contains(&"old-role".to_owned()),
            "stale file must be in deleted list"
        );
        assert!(!stale_path.exists(), "stale file must be removed from disk");
    }

    #[test]
    fn sync_roles_does_not_touch_user_authored_files() {
        let reg_tmp = TempDir::new().unwrap();
        let agents_tmp = TempDir::new().unwrap();
        let agents_dir = agents_tmp.path().join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        let pool = fresh_sync_pool();

        // A user-authored file: no catique- prefix.
        let user_file = agents_dir.join("my-custom-agent.md");
        std::fs::write(&user_file, "# My agent\nDo stuff.").unwrap();

        // A catique-prefixed file without managed frontmatter.
        let handmade = agents_dir.join("catique-handmade.md");
        std::fs::write(&handmade, "---\ntitle: not managed\n---\nContent.").unwrap();

        let uc = sync_use_case(&reg_tmp, agents_dir.clone(), pool);
        let report = uc.sync_roles_to_client("test-client".into()).unwrap();

        // Both files must survive.
        assert!(user_file.exists(), "user-authored file must not be deleted");
        assert!(handmade.exists(), "catique-prefixed without managed marker must survive");

        // Both must appear in skipped.
        assert!(
            report.skipped.contains(&"my-custom-agent.md".to_owned()),
            "user file must be in skipped"
        );
        assert!(
            report.skipped.contains(&"catique-handmade.md".to_owned()),
            "unmanaged catique-prefixed file must be in skipped"
        );
    }

    #[test]
    fn parse_frontmatter_roundtrip() {
        let content = "---\nmanaged-by: catique-hub\nrole-id: abc-123\nsynced-at: 9999\n---\nbody";
        let fm = parse_frontmatter(content).expect("should parse");
        assert_eq!(fm.managed_by.as_deref(), Some("catique-hub"));
        assert_eq!(fm.role_id.as_deref(), Some("abc-123"));
        assert_eq!(fm.synced_at, Some(9999));
    }

    #[test]
    fn parse_frontmatter_returns_none_when_no_delimiter() {
        let content = "just a plain file without frontmatter";
        assert!(parse_frontmatter(content).is_none());
    }

    #[test]
    fn render_role_file_golden_string() {
        let entry = RoleEntry {
            role_id: "test-role".into(),
            role_name: "Test Role".into(),
            role_content: "You are a tester.".into(),
            role_color: Some("#00ff00".into()),
            prompts: vec![AttachedPrompt {
                name: "Style Guide".into(),
                content: "Always use snake_case.".into(),
            }],
        };
        let output = render_role_file(&entry, 1_000, "md");
        assert!(output.starts_with("---\n"));
        assert!(output.contains("managed-by: catique-hub"));
        assert!(output.contains("role-id: test-role"));
        assert!(output.contains("synced-at: 1000"));
        assert!(output.contains("color: \"#00ff00\""));
        assert!(output.contains("You are a tester."));
        assert!(output.contains("## Style Guide"));
        assert!(output.contains("Always use snake_case."));
    }

    #[test]
    fn list_synced_roles_returns_empty_when_dir_absent() {
        let reg_tmp = TempDir::new().unwrap();
        let agents_dir = reg_tmp.path().join("nonexistent").join("agents");
        let pool = fresh_sync_pool();
        let uc = sync_use_case(&reg_tmp, agents_dir, pool);
        let result = uc.list_synced_roles("test-client").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn sync_then_list_round_trips() {
        let reg_tmp = TempDir::new().unwrap();
        let agents_tmp = TempDir::new().unwrap();
        let agents_dir = agents_tmp.path().join("agents");
        let pool = fresh_sync_pool();

        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, color, created_at, updated_at) \
                 VALUES ('r-roundtrip', 'RT Role', 'content', NULL, 0, 0)",
                [],
            )
            .unwrap();
        }

        let uc = sync_use_case(&reg_tmp, agents_dir.clone(), pool);
        uc.sync_roles_to_client("test-client".into()).unwrap();

        let listed = uc.list_synced_roles("test-client").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].role_id, "r-roundtrip");
        assert_eq!(listed[0].client_id, "test-client");
    }
}
