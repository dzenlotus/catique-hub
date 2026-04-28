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
use tauri::State;

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
#[tauri::command]
pub async fn import_from_promptery(
    _state: State<'_, AppState>,
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
    let src: Option<PathBuf> = source_path.map(PathBuf::from);
    let uc = ImportUseCase::new(&target);
    uc.import(src.as_deref(), &options)
}
