//! `role_notes` domain handlers (ctq-137 / MEM-S1).
//!
//! Tauri IPC for the per-role retrospective memory store. The
//! agent-facing surface (`recall_role_notes` / `add_role_note` /
//! `list_role_tags`) is exposed separately through the MCP bridge in
//! `crate::mcp_bridge` — that path always pins `authored_by = "agent"`.
//! The IPC handlers below also accept user-authored notes coming from
//! the Settings → Role Memory page (MEM-S2).
//!
//! Events emitted: `role_note:created` / `role_note:updated` /
//! `role_note:deleted`. Payload `{ roleId, noteId }` so the frontend
//! can scope its react-query invalidation by role.

use catique_application::{
    role_notes::{RoleNotesUseCase, TagCount},
    AppError,
};
use catique_domain::{RoleNote, RoleNoteAuthor};
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2-style empty marker; the real registration is the
/// `tauri::generate_handler!` list in `src-tauri/src/lib.rs`.
pub fn register() {}

/// IPC: insert one note. `authored_by` controls the discriminator —
/// the IPC accepts either `"agent"` or `"user"` because the Settings
/// page also creates notes; the MCP-bridge variant pins it to
/// `"agent"`.
///
/// # Errors
///
/// Forwards every error from [`RoleNotesUseCase::add`].
#[tauri::command]
pub async fn add_role_note(
    state: State<'_, AppState>,
    role_id: String,
    body: String,
    tags: Vec<String>,
    source_task_id: Option<String>,
    authored_by: RoleNoteAuthor,
) -> Result<RoleNote, AppError> {
    let note = RoleNotesUseCase::new(&state.pool).add(
        &role_id,
        body,
        tags,
        source_task_id,
        authored_by,
    )?;
    events::emit(
        &state,
        events::ROLE_NOTE_CREATED,
        json!({ "roleId": note.role_id, "noteId": note.id }),
    );
    Ok(note)
}

/// IPC: partial update — body, tags, priority, pinned. `tags = Some(_)`
/// replaces the entire tag list.
///
/// # Errors
///
/// Forwards every error from [`RoleNotesUseCase::update`].
#[tauri::command]
pub async fn update_role_note(
    state: State<'_, AppState>,
    id: String,
    body: Option<String>,
    tags: Option<Vec<String>>,
    priority: Option<i64>,
    pinned: Option<bool>,
) -> Result<RoleNote, AppError> {
    let note = RoleNotesUseCase::new(&state.pool).update(&id, body, tags, priority, pinned)?;
    events::emit(
        &state,
        events::ROLE_NOTE_UPDATED,
        json!({ "roleId": note.role_id, "noteId": note.id }),
    );
    Ok(note)
}

/// IPC: delete one note.
///
/// # Errors
///
/// Forwards every error from [`RoleNotesUseCase::delete`].
#[tauri::command]
pub async fn delete_role_note(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    // GET first so the event payload can carry `roleId` — the frontend
    // scopes invalidation per role.
    let uc = RoleNotesUseCase::new(&state.pool);
    let note = uc.get(&id)?;
    uc.delete(&id)?;
    events::emit(
        &state,
        events::ROLE_NOTE_DELETED,
        json!({ "roleId": note.role_id, "noteId": id }),
    );
    Ok(())
}

/// IPC: lookup by id.
///
/// # Errors
///
/// `AppError::NotFound` if id is unknown.
#[tauri::command]
pub async fn get_role_note(state: State<'_, AppState>, id: String) -> Result<RoleNote, AppError> {
    RoleNotesUseCase::new(&state.pool).get(&id)
}

/// IPC: list every note for a role (newest first). The Settings page
/// feeds off this; agents should prefer `recall_role_notes`.
///
/// # Errors
///
/// Forwards every error from [`RoleNotesUseCase::list_for_role`].
#[tauri::command]
pub async fn list_role_notes(
    state: State<'_, AppState>,
    role_id: String,
) -> Result<Vec<RoleNote>, AppError> {
    RoleNotesUseCase::new(&state.pool).list_for_role(&role_id)
}

/// IPC: return the `(tag, count)` cloud for the role.
///
/// # Errors
///
/// Forwards every error from [`RoleNotesUseCase::list_tags`].
#[tauri::command]
pub async fn list_role_note_tags(
    state: State<'_, AppState>,
    role_id: String,
) -> Result<Vec<TagCount>, AppError> {
    RoleNotesUseCase::new(&state.pool).list_tags(&role_id)
}

/// IPC: recall notes by tag overlap, with FTS5 fallback.
///
/// `limit` is optional; `None` → 20 (a reasonable default for the
/// agent surface). The use-case layer caps at 50.
///
/// # Errors
///
/// Forwards every error from [`RoleNotesUseCase::recall`].
#[tauri::command]
pub async fn recall_role_notes(
    state: State<'_, AppState>,
    role_id: String,
    tags: Vec<String>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<RoleNote>, AppError> {
    // Negative or absurdly large `limit` clamps to a sane default.
    let resolved_limit: usize = match limit {
        None => 20,
        Some(n) if n <= 0 => 0,
        Some(n) => usize::try_from(n).unwrap_or(50),
    };
    RoleNotesUseCase::new(&state.pool).recall(&role_id, &tags, query.as_deref(), resolved_limit)
}
