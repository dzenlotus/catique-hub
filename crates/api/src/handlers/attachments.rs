//! `attachments` domain handlers.
//!
//! Wave-E2.4 (Olga). Metadata-only CRUD — physical-blob handling is
//! deferred to E3. The `create` call expects the caller to have
//! already written the blob under `<app_data>/attachments/<task_id>/`
//! and provides only the metadata row.

use catique_application::{attachments::AttachmentsUseCase, AppError};
use catique_domain::Attachment;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every attachment metadata row.
///
/// # Errors
///
/// Forwards every error from `AttachmentsUseCase::list`.
#[tauri::command]
pub async fn list_attachments(state: State<'_, AppState>) -> Result<Vec<Attachment>, AppError> {
    AttachmentsUseCase::new(&state.pool).list()
}

/// IPC: look up an attachment by id.
///
/// # Errors
///
/// Forwards every error from `AttachmentsUseCase::get`.
#[tauri::command]
pub async fn get_attachment(
    state: State<'_, AppState>,
    id: String,
) -> Result<Attachment, AppError> {
    AttachmentsUseCase::new(&state.pool).get(&id)
}

/// IPC: create an attachment metadata row.
///
/// # Errors
///
/// Forwards every error from `AttachmentsUseCase::create`.
#[tauri::command]
pub async fn create_attachment(
    state: State<'_, AppState>,
    task_id: String,
    filename: String,
    mime_type: String,
    size_bytes: i64,
    storage_path: String,
    uploaded_by: Option<String>,
) -> Result<Attachment, AppError> {
    let attachment = AttachmentsUseCase::new(&state.pool).create(
        task_id,
        filename,
        mime_type,
        size_bytes,
        storage_path,
        uploaded_by,
    )?;
    events::emit(
        &state,
        events::ATTACHMENT_CREATED,
        json!({ "id": attachment.id, "task_id": attachment.task_id }),
    );
    Ok(attachment)
}

/// IPC: partial-update an attachment.
///
/// # Errors
///
/// Forwards every error from `AttachmentsUseCase::update`.
#[tauri::command]
pub async fn update_attachment(
    state: State<'_, AppState>,
    id: String,
    filename: Option<String>,
    uploaded_by: Option<Option<String>>,
) -> Result<Attachment, AppError> {
    let attachment = AttachmentsUseCase::new(&state.pool).update(id, filename, uploaded_by)?;
    // Brief lists `attachment.{created,deleted}` only — but `update`
    // exists in the IPC surface (filename / uploaded_by patches), and
    // a missing event would let the file-list view drift. We follow
    // the same shape as `created`/`deleted` so listeners can dedupe.
    events::emit(
        &state,
        events::ATTACHMENT_UPDATED,
        json!({ "id": attachment.id, "task_id": attachment.task_id }),
    );
    Ok(attachment)
}

/// IPC: delete an attachment metadata row.
///
/// # Errors
///
/// Forwards every error from `AttachmentsUseCase::delete`.
#[tauri::command]
pub async fn delete_attachment(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let uc = AttachmentsUseCase::new(&state.pool);
    let attachment = uc.get(&id)?;
    uc.delete(&id)?;
    events::emit(
        &state,
        events::ATTACHMENT_DELETED,
        json!({ "id": id, "task_id": attachment.task_id }),
    );
    Ok(())
}
