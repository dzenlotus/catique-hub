//! `ImportFromPromptery` use case.
//!
//! Wave-E2.7 (Olga, 2026-04-28). Wires together the infrastructure-side
//! primitives (preflight, copy, sequencer, attachments) into the
//! end-to-end Promptery v0.4 → Catique import flow described in
//! migration plan v0.5 (D-027) and decision-log D-029.
//!
//! ## Telemetry
//!
//! Per D-021 Q-4 (closed in D-027) — zero events. The `ImportReport` is
//! serialised to the IPC return value AND optionally appended to the
//! local logs directory. No network I/O.
//!
//! ## Non-goals (deferred)
//!
//! * MCP `tools/list` snapshot diff (AC-5) — that's a separate task
//!   under E5.
//! * Progress events to the UI mid-import (callback-based) — v1.1.
//!   First-launch import is fast enough (<10 s on golden M1) that the
//!   UI just shows a spinner and the report.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use catique_domain::{ImportOptions, ImportReport, PrompteryDbInfo};
use catique_infrastructure::db::pool::{open as open_pool, Pool};
use catique_infrastructure::db::runner::run_pending;
use catique_infrastructure::import::{
    self, copy_attachments, run_import_transaction, snapshot_source, ImportError,
};
use catique_infrastructure::import::attachments::default_source_attachments_dir;
use catique_infrastructure::import::preflight::{run_preflight, PreflightContext};
use catique_infrastructure::import::schema::{compute_db_schema_fingerprint, open_readonly};

use crate::error::AppError;

/// Use case that performs the import.
pub struct ImportUseCase<'a> {
    /// Catique data dir root. Final DB lands at
    /// `<target_data_dir>/db.sqlite`. Working files at
    /// `<target_data_dir>/.import-tmp/`. Attachments at
    /// `<target_data_dir>/attachments/`.
    pub target_data_dir: &'a Path,
}

/// Outcome of [`ImportUseCase::detect`]. `None` means no source DB was
/// found at the conventional path.
pub type DetectOutcome = Option<PrompteryDbInfo>;

impl<'a> ImportUseCase<'a> {
    /// Construct.
    #[must_use]
    pub fn new(target_data_dir: &'a Path) -> Self {
        Self { target_data_dir }
    }

    /// Detect a Promptery DB at `~/.promptery/db.sqlite` (or the
    /// caller-supplied `source`).
    ///
    /// # Errors
    ///
    /// Returns `AppError::Validation` if the path was supplied but
    /// the file is not readable in a way that breaks
    /// `PrompteryDbInfo` construction. Common cases (file absent,
    /// directory) return `Ok(None)`.
    pub fn detect(source_override: Option<&Path>) -> Result<DetectOutcome, AppError> {
        let path = match source_override {
            Some(p) => p.to_owned(),
            None => default_source_path(),
        };
        let md = match std::fs::metadata(&path) {
            Ok(m) if m.is_file() && m.len() > 0 => m,
            _ => return Ok(None),
        };
        let last_modified_ms = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .and_then(|d| i64::try_from(d.as_millis()).ok())
            .unwrap_or(0);

        let conn = open_readonly(&path).map_err(map_import_err)?;
        let schema_hash = compute_db_schema_fingerprint(&conn).map_err(map_import_err)?;
        // tasks_count is best-effort: the DB might be a Promptery v0.3
        // (pre-spaces) where the table layout differs; tolerate that.
        let tasks_count = conn
            .query_row("SELECT count(*) FROM tasks", [], |r| r.get::<_, i64>(0))
            .ok()
            .and_then(|n| u64::try_from(n).ok());

        Ok(Some(PrompteryDbInfo {
            path: path.to_string_lossy().into_owned(),
            size_bytes: md.len(),
            schema_hash,
            tasks_count,
            last_modified_ms,
        }))
    }

    /// Run the import. Honours [`ImportOptions::dry_run`] and
    /// [`ImportOptions::overwrite_existing`].
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for preflight / contract failures.
    /// `AppError::TransactionRolledBack` for SQL errors. Filesystem
    /// errors map to `TransactionRolledBack` with the IO reason
    /// included.
    #[allow(clippy::too_many_lines)] // Linear pipeline; splitting it would obscure flow.
    pub fn import(
        &self,
        source_override: Option<&Path>,
        options: &ImportOptions,
    ) -> Result<ImportReport, AppError> {
        let started_at_ms = now_ms();
        let source_path =
            source_override.map_or_else(default_source_path, Path::to_path_buf);

        let target_db_path = self.target_data_dir.join("db.sqlite");
        let target_attachments = self.target_data_dir.join("attachments");
        let tmp_dir = self.target_data_dir.join(".import-tmp");

        let attachments_dir = default_source_attachments_dir(&source_path);

        // -------- Preflight --------
        let pf_ctx = PreflightContext {
            source_path: &source_path,
            target_data_dir: self.target_data_dir,
            target_db_path: &target_db_path,
            overwrite_existing: options.overwrite_existing,
            attachments_dir: attachments_dir.as_deref(),
        };
        let pf = run_preflight(&pf_ctx).map_err(map_import_err)?;

        let mut report = ImportReport {
            started_at_ms,
            finished_at_ms: 0,
            duration_ms: 0,
            source_path: source_path.to_string_lossy().into_owned(),
            source_size_bytes: pf.source_size_bytes,
            source_schema_hash: pf.source_schema_hash.clone(),
            target_schema_hash: pf.target_schema_hash.clone(),
            schema_match: !pf.source_schema_hash.is_empty()
                && pf.source_schema_hash == pf.target_schema_hash,
            preflight: pf.results.clone(),
            rows_imported: std::collections::BTreeMap::new(),
            fts_rows_rebuilt: std::collections::BTreeMap::new(),
            attachments_copied: 0,
            attachments_total_bytes: 0,
            dry_run: options.dry_run,
            commit_path: None,
            error: None,
        };

        if !pf.results.all_ok() {
            return finalise(
                report,
                Err(AppError::Validation {
                    field: "preflight".into(),
                    reason: format_preflight_errors(&pf.results),
                }),
            );
        }

        // -------- Snapshot source (read-only copy) --------
        let snap = match snapshot_source(&source_path, &tmp_dir) {
            Ok(s) => s,
            Err(e) => {
                return finalise(report, Err(map_import_err(e)));
            }
        };

        // -------- Build target DB at .import-tmp/db.sqlite --------
        let working_db_path = tmp_dir.join("db.sqlite");
        let _ = std::fs::remove_file(&working_db_path);
        let working_pool = match open_pool(&working_db_path) {
            Ok(p) => p,
            Err(e) => return finalise(report, Err(map_db_err(e))),
        };
        if let Err(e) = apply_catique_migrations(&working_pool) {
            return finalise(report, Err(e));
        }

        // -------- Run the 28-step copy --------
        let import_outcome = {
            let Ok(mut conn) = working_pool.get() else {
                return finalise(report, Err(AppError::DbBusy));
            };
            run_import_transaction(&mut conn, &snap.copy_path)
        };
        match import_outcome {
            Ok(out) => {
                report.rows_imported = out.rows_imported;
                report.fts_rows_rebuilt = out.fts_rows_rebuilt;
            }
            Err(e) => return finalise(report, Err(map_import_err(e))),
        }

        // -------- Copy attachments --------
        if let Some(src) = attachments_dir.as_deref() {
            let attach_tmp = tmp_dir.join("attachments");
            let conn = match open_readonly(&snap.copy_path) {
                Ok(c) => c,
                Err(e) => return finalise(report, Err(map_import_err(e))),
            };
            match copy_attachments(&conn, Some(src), &attach_tmp) {
                Ok(out) => {
                    report.attachments_copied = out.copied;
                    report.attachments_total_bytes = out.total_bytes;
                }
                Err(e) => return finalise(report, Err(map_import_err(e))),
            }
        }

        // -------- Atomic rename (skip on dry-run) --------
        if options.dry_run {
            // Leave the working DB inside `.import-tmp/`; clean up.
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return finalise(report, Ok(()));
        }

        // Backup existing DB if it has data and overwrite=true
        if options.overwrite_existing {
            if let Ok(md) = std::fs::metadata(&target_db_path) {
                if md.is_file() && md.len() > 0 {
                    let bak = target_db_path.with_extension(format!(
                        "sqlite.{}.bak",
                        iso8601_now()
                    ));
                    let _ = std::fs::rename(&target_db_path, &bak);
                }
            }
        }

        // Close the pool by dropping it before rename — Windows demands
        // it; macOS / Linux tolerate open handles but may keep WAL
        // files alive.
        drop(working_pool);

        if let Err(e) = std::fs::rename(&working_db_path, &target_db_path) {
            return finalise(report, Err(map_import_err(ImportError::Io(e))));
        }
        // Also rename the attachments directory if we created one.
        let attach_tmp = tmp_dir.join("attachments");
        if attach_tmp.exists() {
            // If a previous Catique install had attachments, append
            // rather than blow them away.
            std::fs::create_dir_all(&target_attachments).ok();
            // Move children one-by-one so we don't clobber siblings.
            if let Err(e) = move_dir_contents(&attach_tmp, &target_attachments) {
                return finalise(report, Err(map_import_err(ImportError::Io(e))));
            }
        }
        // Cleanup tmp
        let _ = std::fs::remove_dir_all(&tmp_dir);

        report.commit_path = Some(target_db_path.to_string_lossy().into_owned());
        finalise(report, Ok(()))
    }
}

fn finalise(
    mut report: ImportReport,
    result: Result<(), AppError>,
) -> Result<ImportReport, AppError> {
    let finished = now_ms();
    report.finished_at_ms = finished;
    report.duration_ms = u64::try_from(finished - report.started_at_ms).unwrap_or(0);
    match result {
        Ok(()) => Ok(report),
        Err(e) => {
            report.error = Some(e.to_string());
            Err(e)
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

fn iso8601_now() -> String {
    use chrono::SecondsFormat;
    chrono::Utc::now()
        .to_rfc3339_opts(SecondsFormat::Secs, true)
        .replace(':', "-")
}

fn default_source_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".promptery").join("db.sqlite")
}

fn apply_catique_migrations(pool: &Pool) -> Result<(), AppError> {
    let mut conn = pool.get().map_err(|_| AppError::DbBusy)?;
    run_pending(&mut conn).map_err(|e| AppError::TransactionRolledBack {
        reason: e.to_string(),
    })?;
    Ok(())
}

fn move_dir_contents(src: &Path, dst: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        // If the target already has this child, fall back to a recursive copy
        // so we don't fail on filesystem cross-device moves.
        match std::fs::rename(&from, &to) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if entry.file_type()?.is_dir() {
                    std::fs::create_dir_all(&to)?;
                    move_dir_contents(&from, &to)?;
                } else {
                    std::fs::copy(&from, &to)?;
                    let _ = std::fs::remove_file(&from);
                }
            }
            Err(_) => {
                // Cross-filesystem fallback.
                if entry.file_type()?.is_dir() {
                    copy_dir_recursive(&from, &to)?;
                } else {
                    std::fs::copy(&from, &to)?;
                    let _ = std::fs::remove_file(&from);
                }
            }
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn map_db_err(err: catique_infrastructure::db::pool::DbError) -> AppError {
    use catique_infrastructure::db::pool::DbError;
    match err {
        DbError::PoolTimeout(_) | DbError::Pool(_) => AppError::DbBusy,
        DbError::Sqlite(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
        DbError::Io(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
    }
}

fn map_import_err(err: import::ImportError) -> AppError {
    match err {
        ImportError::Validation { reason } => AppError::Validation {
            field: "import".into(),
            reason,
        },
        ImportError::Io(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
        ImportError::Sqlite(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
        ImportError::PoolTimeout => AppError::DbBusy,
    }
}

fn format_preflight_errors(pf: &catique_domain::PreflightResults) -> String {
    let mut parts: Vec<String> = Vec::new();
    let table = [
        ("PF-1", pf.pf1_source_exists),
        ("PF-2", pf.pf2_integrity_ok),
        ("PF-3", pf.pf3_quick_check_ok),
        ("PF-4", pf.pf4_schema_hash_ok),
        ("PF-5", pf.pf5_target_writable),
        ("PF-6", pf.pf6_disk_space_ok),
        ("PF-7", pf.pf7_source_lock_ok),
        ("PF-8", pf.pf8_foreign_keys_on),
        ("PF-9", pf.pf9_target_empty_or_overwrite),
        ("PF-10", pf.pf10_attachments_readable),
    ];
    for (key, ok) in table {
        if !ok {
            let detail = pf
                .messages
                .get(key)
                .map_or("(no detail)", String::as_str);
            parts.push(format!("{key} failed: {detail}"));
        }
    }
    parts.join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        let dir = std::env::temp_dir().join(format!(
            "catique-imp-{}-{label}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn golden_fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/promptery-v0.4-golden.sqlite")
    }

    #[test]
    fn detect_returns_none_on_missing() {
        let nowhere = std::env::temp_dir().join(format!(
            "catique-imp-detect-{}-nope.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&nowhere);
        let r = ImportUseCase::detect(Some(&nowhere)).unwrap();
        assert!(r.is_none());
    }

    #[test]
    fn detect_summarises_golden_fixture() {
        let golden = golden_fixture_path();
        if !golden.exists() {
            return;
        }
        let info = ImportUseCase::detect(Some(&golden))
            .unwrap()
            .expect("present");
        assert!(info.size_bytes > 0);
        assert_eq!(info.tasks_count, Some(1000));
        assert!(!info.schema_hash.is_empty());
    }

    #[test]
    fn dry_run_leaves_no_target_db() {
        let golden = golden_fixture_path();
        if !golden.exists() {
            return;
        }
        let target = unique_tmp("dryrun");
        let uc = ImportUseCase::new(&target);
        let report = uc
            .import(
                Some(&golden),
                &ImportOptions {
                    dry_run: true,
                    overwrite_existing: false,
                },
            )
            .expect("import dry-run");
        assert!(report.dry_run);
        assert!(report.commit_path.is_none());
        assert_eq!(report.rows_imported["tasks"], 1000);
        assert!(!target.join("db.sqlite").exists());
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn real_import_creates_target_db() {
        let golden = golden_fixture_path();
        if !golden.exists() {
            return;
        }
        let target = unique_tmp("real");
        let uc = ImportUseCase::new(&target);
        let report = uc
            .import(Some(&golden), &ImportOptions::default())
            .expect("import");
        assert!(!report.dry_run);
        let final_db = target.join("db.sqlite");
        assert!(final_db.exists());
        assert_eq!(
            report.commit_path.as_deref(),
            Some(final_db.to_str().unwrap())
        );
        // Sanity-check directly with rusqlite.
        let conn = rusqlite::Connection::open(&final_db).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1000);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn pf9_blocks_non_empty_target_without_overwrite() {
        let golden = golden_fixture_path();
        if !golden.exists() {
            return;
        }
        let target = unique_tmp("pf9block");
        // Plant a non-empty file at db.sqlite
        std::fs::write(target.join("db.sqlite"), b"some bytes 0123456789")
            .unwrap();
        let uc = ImportUseCase::new(&target);
        let err = uc
            .import(Some(&golden), &ImportOptions::default())
            .expect_err("must block");
        match err {
            AppError::Validation { reason, .. } => {
                assert!(reason.contains("PF-9"), "got: {reason}");
            }
            other => panic!("got {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn overwrite_creates_backup() {
        let golden = golden_fixture_path();
        if !golden.exists() {
            return;
        }
        let target = unique_tmp("over");
        // Plant a non-empty existing DB
        std::fs::write(target.join("db.sqlite"), b"existing-data-1234567890")
            .unwrap();
        let uc = ImportUseCase::new(&target);
        let report = uc
            .import(
                Some(&golden),
                &ImportOptions {
                    dry_run: false,
                    overwrite_existing: true,
                },
            )
            .expect("import overwrite");
        assert!(report.commit_path.is_some());
        // At least one .bak should exist
        let bak_count = std::fs::read_dir(&target)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("db.sqlite.")
            })
            .count();
        assert!(bak_count >= 1, "expected at least one .bak file");
        let _ = std::fs::remove_dir_all(&target);
    }
}
