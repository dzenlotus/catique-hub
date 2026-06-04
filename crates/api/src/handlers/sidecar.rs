//! Sidecar lifecycle IPC handlers — ADR-0002 spike (ctq-56).
//!
//! Exposes five commands:
//!
//! * [`sidecar_status`]  — current [`SidecarStatus`].
//! * [`sidecar_ping`]    — round-trip latency in microseconds.
//! * [`sidecar_start`]   — manual start from the UI (idempotent).
//! * [`sidecar_stop`]    — manual stop from the UI (idempotent).
//! * [`sidecar_restart`] — manual restart from the UI.
//!
//! These are intentionally thin: all logic lives in `catique-sidecar`.
//! PoC for ctq-56 ADR-0002 spike. Real entity slice + react-query hooks in E5.

use std::time::Duration;

use catique_application::AppError;
use catique_sidecar::{SidecarManager, SidecarStatus};
use tauri::State;

use crate::state::AppState;

/// Graceful-stop budget mirrored from the on-exit handler in
/// `src-tauri/src/lib.rs`. After this elapses the child is SIGKILLed.
const STOP_TIMEOUT: Duration = Duration::from_secs(2);

/// IPC: return the current sidecar lifecycle status.
///
/// # Errors
///
/// None in practice — reading status is infallible. The `Result` wrapper
/// is required by the Tauri command infrastructure.
#[tauri::command]
pub async fn sidecar_status(state: State<'_, AppState>) -> Result<SidecarStatus, AppError> {
    let mgr = state.sidecar.clone();
    Ok(mgr.status().await)
}

/// IPC: send a `ping` to the sidecar and return the round-trip latency in
/// microseconds.
///
/// # Errors
///
/// Returns `AppError::Validation` with context when the sidecar is not
/// running or ping times out.
#[tauri::command]
pub async fn sidecar_ping(state: State<'_, AppState>) -> Result<u64, AppError> {
    let mgr = state.sidecar.clone();
    mgr.ping().await.map_err(|e| AppError::Validation {
        field: "sidecar_ping".into(),
        reason: e.to_string(),
    })
}

/// IPC: manually restart the sidecar.
///
/// Respects the restart policy (≤ 3 restarts / 60 s). Returns
/// `AppError::Validation` when the policy is exceeded or restart fails.
///
/// # Errors
///
/// Propagates `SidecarError` as `AppError::Validation`.
#[tauri::command]
pub async fn sidecar_restart(state: State<'_, AppState>) -> Result<(), AppError> {
    let mgr: SidecarManager = state.sidecar.clone();
    let dir = state.sidecar_dir.clone();
    mgr.restart(&dir)
        .await
        .map(|_| ())
        .map_err(|e| AppError::Validation {
            field: "sidecar_restart".into(),
            reason: e.to_string(),
        })
}

/// IPC: manually start the sidecar.
///
/// Idempotent — calling while the sidecar is already `Running` is a
/// no-op (see [`SidecarManager::start`]). The returned pid is discarded
/// because the UI reads status via the polling hook.
///
/// # Errors
///
/// Returns `AppError::Validation` when the spawn fails (missing
/// `node`, missing sidecar dir, etc.). Mirrors how
/// [`sidecar_restart`] reports lifecycle failures.
#[tauri::command]
pub async fn sidecar_start(state: State<'_, AppState>) -> Result<(), AppError> {
    let mgr: SidecarManager = state.sidecar.clone();
    let dir = state.sidecar_dir.clone();
    mgr.start(&dir)
        .await
        .map(|_| ())
        .map_err(|e| AppError::Validation {
            field: "sidecar_start".into(),
            reason: e.to_string(),
        })
}

/// IPC: manually stop the sidecar.
///
/// Idempotent — safe to call when the sidecar is already `Stopped`
/// (see [`SidecarManager::stop`]).
///
/// # Errors
///
/// In practice infallible; the `Result` is preserved to mirror the
/// other lifecycle commands so callers can use a single error path.
#[tauri::command]
pub async fn sidecar_stop(state: State<'_, AppState>) -> Result<(), AppError> {
    let mgr: SidecarManager = state.sidecar.clone();
    mgr.stop(STOP_TIMEOUT)
        .await
        .map_err(|e| AppError::Validation {
            field: "sidecar_stop".into(),
            reason: e.to_string(),
        })
}
