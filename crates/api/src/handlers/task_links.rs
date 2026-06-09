//! `task_links` domain handlers (catique-4).
//!
//! Tauri IPC for the minimal task↔task relationship model. Three
//! commands mirror the use-case surface: `link_tasks`, `unlink_tasks`,
//! `list_task_links`.
//!
//! Events emitted: `task_link:created` / `task_link:deleted`. Payload
//! `{ srcTaskId, dstTaskId, kind }` so the frontend can invalidate the
//! link query for *both* endpoints (a link shows up on either task's
//! detail panel).

use catique_application::{task_links::TaskLinksUseCase, AppError};
use catique_domain::{TaskLink, TaskLinkKind};
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2-style empty marker; real registration is the
/// `tauri::generate_handler!` list in `src-tauri/src/lib.rs`.
pub fn register() {}

/// IPC: create one link between two tasks. Idempotent.
///
/// # Errors
///
/// Forwards every error from [`TaskLinksUseCase::link`].
#[tauri::command]
pub async fn link_tasks(
    state: State<'_, AppState>,
    src_task_id: String,
    dst_task_id: String,
    kind: TaskLinkKind,
) -> Result<TaskLink, AppError> {
    let link = TaskLinksUseCase::new(&state.pool).link(&src_task_id, &dst_task_id, kind)?;
    events::emit(
        &state,
        events::TASK_LINK_CREATED,
        json!({
            "srcTaskId": link.src_task_id,
            "dstTaskId": link.dst_task_id,
            "kind": link.kind,
        }),
    );
    Ok(link)
}

/// IPC: remove one link. Idempotent — removing a missing link is a
/// silent success and still emits the event so any open peer view
/// reconciles.
///
/// # Errors
///
/// Forwards every error from [`TaskLinksUseCase::unlink`].
#[tauri::command]
pub async fn unlink_tasks(
    state: State<'_, AppState>,
    src_task_id: String,
    dst_task_id: String,
    kind: TaskLinkKind,
) -> Result<(), AppError> {
    TaskLinksUseCase::new(&state.pool).unlink(&src_task_id, &dst_task_id, kind)?;
    events::emit(
        &state,
        events::TASK_LINK_DELETED,
        json!({
            "srcTaskId": src_task_id,
            "dstTaskId": dst_task_id,
            "kind": kind,
        }),
    );
    Ok(())
}

/// IPC: list every link a task participates in, either direction.
///
/// # Errors
///
/// Forwards every error from [`TaskLinksUseCase::list_for_task`].
#[tauri::command]
pub async fn list_task_links(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<TaskLink>, AppError> {
    TaskLinksUseCase::new(&state.pool).list_for_task(&task_id)
}
