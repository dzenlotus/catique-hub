//! Import-from-Promptery domain types.
//!
//! Wave-E2.7 (Olga, 2026-04-28). Per migration plan v0.5 (D-027) and
//! decision-log D-029. The IPC contract defined here is consumed by the
//! Catique UI on first launch (Anna's wave) to trigger the one-shot
//! Promptery → Catique data import.
//!
//! Three types live here:
//!
//! * [`PrompteryDbInfo`] — shape of the existing `~/.promptery/db.sqlite`
//!   discovered on disk (returned by `detect_promptery_db`).
//! * [`ImportOptions`] — caller-supplied switches for the import run.
//! * [`ImportReport`] — full forensic record of one import attempt
//!   (whether dry-run or real). Includes preflight outcomes, per-table
//!   row counts, FTS rebuild counts, attachments-copy counters, and
//!   timing/path metadata.
//!
//! All three derive `TS` with `export = "../../../bindings/"` so the UI
//! sees them as `bindings/PrompteryDbInfo.ts` / `ImportOptions.ts` /
//! `ImportReport.ts` after `cargo test -p catique-domain` runs.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Summary of the source Promptery DB discovered on disk.
///
/// Returned by `detect_promptery_db` IPC command. The UI uses this to
/// render the "Found Promptery DB — import?" first-launch dialog.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct PrompteryDbInfo {
    /// Absolute resolved path to the discovered DB. Typically
    /// `~/.promptery/db.sqlite`, but may resolve a symlink.
    pub path: String,
    /// Size of the DB file (bytes).
    pub size_bytes: u64,
    /// SHA-256 of (schema.sql || migrations[sorted]) as defined in D-019.
    /// Allows the UI to surface "schema drift detected" before invoking
    /// import.
    pub schema_hash: String,
    /// Quick row-count of `tasks` (NULL if the table cannot be read).
    pub tasks_count: Option<u64>,
    /// Last-modified epoch ms, taken from filesystem metadata.
    pub last_modified_ms: i64,
}

/// Caller-supplied import options.
///
/// Default per D-029: `dry_run = false`, `overwrite_existing = false`.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    /// `true` → run preflight + simulated INSERTs in a single transaction
    /// then ROLLBACK + cleanup `.import-tmp/`. No mutation of the live
    /// target DB. Default: `false` (per D-029 #1).
    #[serde(default)]
    pub dry_run: bool,
    /// `true` → if the target DB already has data, back it up to
    /// `db.sqlite.<ISO8601>.bak` then proceed. Default: `false` —
    /// preflight PF-9 fails fast on a non-empty target.
    #[serde(default)]
    pub overwrite_existing: bool,
}

/// Outcome of the 10 preflight checks (PF-1..PF-10) from migration plan
/// v0.5 §3.2 step 1.
///
/// Each boolean is `true` iff the check passed. `messages` carries
/// human-readable detail for the UI (and the failure log if any check
/// fired). The map is keyed by a stable short tag (`"PF-1"`, `"PF-2"`,
/// …) so the UI can localise without re-parsing the message text.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct PreflightResults {
    /// PF-1: source DB exists and is readable.
    pub pf1_source_exists: bool,
    /// PF-2: `PRAGMA integrity_check` returned `ok`.
    pub pf2_integrity_ok: bool,
    /// PF-3: `PRAGMA quick_check` + FTS smoke counts pass.
    pub pf3_quick_check_ok: bool,
    /// PF-4: schema hash matches `EXPECTED_SOURCE_SCHEMA_HASH`.
    pub pf4_schema_hash_ok: bool,
    /// PF-5: target data dir is writable (probe write).
    pub pf5_target_writable: bool,
    /// PF-6: free disk ≥ 2× source size.
    pub pf6_disk_space_ok: bool,
    /// PF-7: lock acquired on source (read-only).
    pub pf7_source_lock_ok: bool,
    /// PF-8: source FK enforcement enabled (`foreign_keys = ON`).
    pub pf8_foreign_keys_on: bool,
    /// PF-9: target DB empty OR `overwrite_existing = true`.
    pub pf9_target_empty_or_overwrite: bool,
    /// PF-10: attachments folder readable on source side (or absent —
    /// some installs have none, that's fine).
    pub pf10_attachments_readable: bool,

    /// Human-readable per-PF detail. Empty string = no extra info.
    /// Key names: `"PF-1"`, `"PF-2"`, …, `"PF-10"`.
    #[serde(default)]
    pub messages: BTreeMap<String, String>,
}

impl PreflightResults {
    /// Returns `true` when every check passed.
    #[must_use]
    pub fn all_ok(&self) -> bool {
        self.pf1_source_exists
            && self.pf2_integrity_ok
            && self.pf3_quick_check_ok
            && self.pf4_schema_hash_ok
            && self.pf5_target_writable
            && self.pf6_disk_space_ok
            && self.pf7_source_lock_ok
            && self.pf8_foreign_keys_on
            && self.pf9_target_empty_or_overwrite
            && self.pf10_attachments_readable
    }
}

/// Forensic record of one import run.
///
/// Returned by `import_from_promptery`. The UI shows the user a summary
/// (rows imported per table, attachments copied, total bytes); the same
/// `ImportReport` is also written to the import log under
/// `$APPLOCALDATA/catique/logs/import-<ISO>.log`.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// Wall-clock start, epoch ms (UTC).
    pub started_at_ms: i64,
    /// Wall-clock finish, epoch ms (UTC).
    pub finished_at_ms: i64,
    /// `finished_at_ms - started_at_ms`. Convenience for the UI.
    pub duration_ms: u64,
    /// Resolved source path (after symlink resolution if any).
    pub source_path: String,
    /// Source file size in bytes.
    pub source_size_bytes: u64,
    /// Computed source schema hash.
    pub source_schema_hash: String,
    /// Expected source schema hash baked into Catique
    /// (`EXPECTED_SOURCE_SCHEMA_HASH`).
    pub target_schema_hash: String,
    /// `source_schema_hash == target_schema_hash`.
    pub schema_match: bool,
    /// PF-1..PF-10 outcomes.
    pub preflight: PreflightResults,
    /// Rows imported per table. Keyed by table name. Sorted (BTreeMap)
    /// so the JSON output is reproducible.
    #[serde(default)]
    pub rows_imported: BTreeMap<String, u64>,
    /// FTS rows rebuilt. Keys: `"tasks_fts"`, `"agent_reports_fts"`.
    #[serde(default)]
    pub fts_rows_rebuilt: BTreeMap<String, u64>,
    /// Number of attachment files copied successfully.
    pub attachments_copied: u64,
    /// Total byte volume of copied attachments.
    pub attachments_total_bytes: u64,
    /// `true` if the run was a dry-run (no mutation outside `.import-tmp/`).
    pub dry_run: bool,
    /// Final committed DB path; `None` for dry-runs and for runs that
    /// errored before the atomic rename step.
    pub commit_path: Option<String>,
    /// Optional human-readable error reason if the import did not
    /// complete. `None` on success.
    #[serde(default)]
    pub error: Option<String>,
}
