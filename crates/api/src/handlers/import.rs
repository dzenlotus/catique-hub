//! Promptery import IPC handlers (E2.7).
//!
//! Exposes two commands:
//!
//! * [`detect_promptery_db`] — scan `~/.promptery/db.sqlite` and return
//!   a `PrompteryDbInfo` summary (or `None` if absent).
//! * [`import_from_promptery`] — run the Wave-A import flow per
//!   migration plan v0.5 (D-027) and return an `ImportReport`.
//!
//! Per D-029 #5 (and D-021 Q-4) — zero telemetry; the report stays
//! local.

use std::path::{Path, PathBuf};

use catique_application::import::ImportUseCase;
use catique_application::AppError;
use catique_domain::{ImportOptions, ImportReport, PrompteryDbInfo};
use catique_infrastructure::paths::app_data_dir;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// Future per-domain init hook.
pub fn register() {}

/// IPC: detect a Promptery DB at the conventional path.
///
/// `source_path = None` → check `~/.promptery/db.sqlite`. Returns
/// `Ok(None)` if no such file exists.
///
/// # Errors
///
/// Forwards every error from `ImportUseCase::detect`.
#[tauri::command]
pub async fn detect_promptery_db(
    _state: State<'_, AppState>,
    source_path: Option<String>,
) -> Result<Option<PrompteryDbInfo>, AppError> {
    let path = source_path.as_deref().map(Path::new);
    ImportUseCase::detect(path)
}

/// IPC: run the import.
///
/// `source_path = None` → use the default `~/.promptery/db.sqlite`.
/// Honours `options.dry_run` and `options.overwrite_existing`.
///
/// # Errors
///
/// Forwards every error from `ImportUseCase::import`.
///
/// # Events
///
/// Emits `import.started` before the use case is invoked, then exactly
/// one of `import.completed` / `import.failed` after it returns.
/// Per-phase progress (`import.progress`) is reserved but not emitted
/// here — the use case is currently a single synchronous call with no
/// callback hook. Wiring fine-grained phase events is tracked under
/// the v1.1 work referenced in `crates/application/src/import.rs`.
#[tauri::command]
pub async fn import_from_promptery(
    state: State<'_, AppState>,
    source_path: Option<String>,
    options: ImportOptions,
) -> Result<ImportReport, AppError> {
    let target = match app_data_dir() {
        Ok(p) => p,
        Err(reason) => {
            return Err(AppError::Validation {
                field: "target_data_dir".into(),
                reason: reason.to_owned(),
            });
        }
    };
    let src: Option<PathBuf> = source_path.clone().map(PathBuf::from);
    events::emit(
        &state,
        events::IMPORT_STARTED,
        json!({
            "source_path": source_path.clone().unwrap_or_default(),
        }),
    );
    let uc = ImportUseCase::new(&target);
    match uc.import(src.as_deref(), &options) {
        Ok(report) => {
            events::emit(
                &state,
                events::IMPORT_COMPLETED,
                json!({
                    "duration_ms": report.duration_ms,
                    "rows_imported": report.rows_imported,
                    "commit_path": report.commit_path,
                    "dry_run": report.dry_run,
                }),
            );
            Ok(report)
        }
        Err(err) => {
            events::emit(
                &state,
                events::IMPORT_FAILED,
                json!({
                    "error_kind": app_error_kind(&err),
                    "message": err.to_string(),
                }),
            );
            Err(err)
        }
    }
}

/// Stable string tag for an [`AppError`] variant — matches the
/// `AppError["kind"]` discriminator on the TS side.
fn app_error_kind(err: &AppError) -> &'static str {
    match err {
        AppError::Validation { .. } => "validation",
        AppError::TransactionRolledBack { .. } => "transactionRolledBack",
        AppError::DbBusy => "dbBusy",
        AppError::LockTimeout { .. } => "lockTimeout",
        AppError::InternalPanic { .. } => "internalPanic",
        AppError::NotFound { .. } => "notFound",
        AppError::Conflict { .. } => "conflict",
        AppError::SecretAccessDenied { .. } => "secretAccessDenied",
    }
}
