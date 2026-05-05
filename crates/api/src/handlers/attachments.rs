//! `attachments` domain handlers.
//!
//! Wave-E2.4 (Olga). Metadata-only CRUD — physical-blob handling is
//! deferred to E3. The `create` call expects the caller to have
//! already written the blob under `<app_data>/attachments/<task_id>/`
//! and provides only the metadata row.
//!
//! Wave-E5 (upload_attachment): adds a blob-aware IPC that picks a
//! file path, copies it into `$APPLOCALDATA/catique/attachments/<task_id>/`,
//! then inserts the metadata row. On copy failure the partial dest file
//! is cleaned up to avoid orphans. On insert failure the copied blob is
//! also removed.

use std::path::{Path, PathBuf};

use catique_application::{attachments::AttachmentsUseCase, AppError};
use catique_domain::Attachment;
use catique_infrastructure::paths::app_data_dir;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list attachment metadata rows.
///
/// `task_id` is an optional filter. When omitted (or explicitly `null`),
/// every row is returned — preserving the legacy global-list behaviour.
/// MCP agents working on a single task should always pass the filter to
/// avoid loading the entire blob registry.
///
/// # Errors
///
/// Forwards every error from `AttachmentsUseCase::list`.
#[tauri::command]
pub async fn list_attachments(
    state: State<'_, AppState>,
    task_id: Option<String>,
) -> Result<Vec<Attachment>, AppError> {
    AttachmentsUseCase::new(&state.pool).list(task_id)
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

// ── upload_attachment ──────────────────────────────────────────────────────

/// Infer a MIME type from a file extension. Falls back to
/// `application/octet-stream` for unrecognised extensions.
fn mime_from_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "csv" => "text/csv",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// Sanitize a filename for use as an on-disk segment. Replaces the
/// characters forbidden by common filesystems (`/`, `\`, `:`, `*`, `?`,
/// `"`, `<`, `>`, `|`) with `_`. The result is still prefixed with the
/// attachment id, so even a fully-sanitized `_________` is unique.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect()
}

/// IPC: copy a file into the task attachment directory and insert the
/// metadata row.
///
/// # Behaviour
///
/// 1. Validates that `source_path` exists and is a regular file.
/// 2. Validates that `task_id` exists in the DB.
/// 3. Resolves the target directory:
///    `$APPLOCALDATA/catique/attachments/<task_id>/` — creates it if absent.
/// 4. Generates a collision-safe storage filename: `<id>_<sanitized_name>`.
/// 5. Copies the source file to the target directory.
/// 6. Reads the file metadata to obtain `size_bytes`.
/// 7. Infers MIME type from extension when `mime_type` is `None`.
/// 8. Inserts the metadata row.
///    On insert failure → cleans up the copied blob to avoid orphans.
///
/// # Errors
///
/// * `AppError::Validation` — source path missing, is a directory, or
///   app data dir cannot be resolved; copy or mkdir failure.
/// * `AppError::NotFound` — `task_id` does not exist.
/// * Other `AppError` variants propagated from the use case.
#[tauri::command]
pub async fn upload_attachment(
    state: State<'_, AppState>,
    task_id: String,
    source_path: String,
    original_filename: String,
    mime_type: Option<String>,
) -> Result<Attachment, AppError> {
    // ── 1. Validate source ────────────────────────────────────────────
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err(AppError::Validation {
            field: "source_path".into(),
            reason: format!("file does not exist: {source_path}"),
        });
    }
    if !src.is_file() {
        return Err(AppError::Validation {
            field: "source_path".into(),
            reason: format!("path is not a regular file: {source_path}"),
        });
    }

    // ── 2. Validate task exists (use case will also check, but we want
    //       the error before we touch the filesystem) ───────────────────
    // The use case's `create` method performs the same DB check; we rely
    // on that and skip a redundant query here to keep the handler thin.

    // ── 3. Resolve target directory ───────────────────────────────────
    let data_root = app_data_dir().map_err(|reason| AppError::Validation {
        field: "target_data_dir".into(),
        reason: reason.to_owned(),
    })?;
    let target_dir = data_root.join("attachments").join(&task_id);
    std::fs::create_dir_all(&target_dir).map_err(|e| AppError::Validation {
        field: "target_data_dir".into(),
        reason: format!("failed to create attachment directory: {e}"),
    })?;

    // ── 4. Build collision-safe storage filename ──────────────────────
    let attachment_id = nanoid::nanoid!();
    let sanitized = sanitize_filename(&original_filename);
    let storage_name = format!("{attachment_id}_{sanitized}");
    let dest = target_dir.join(&storage_name);

    // ── 5. Copy blob ──────────────────────────────────────────────────
    std::fs::copy(&src, &dest).map_err(|e| {
        // Clean up any partial file that may have been created.
        let _ = std::fs::remove_file(&dest);
        AppError::Validation {
            field: "source_path".into(),
            reason: format!("file copy failed: {e}"),
        }
    })?;

    // ── 6. Read size from destination (authoritative after copy) ──────
    let size_bytes = std::fs::metadata(&dest)
        .map(|m| i64::try_from(m.len()).unwrap_or(i64::MAX))
        .unwrap_or(0);

    // ── 7. Infer MIME type ────────────────────────────────────────────
    let resolved_mime = mime_type
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| mime_from_ext(&src).to_owned());

    // ── 8. Insert metadata row ────────────────────────────────────────
    let attachment = AttachmentsUseCase::new(&state.pool)
        .create(
            task_id.clone(),
            original_filename,
            resolved_mime,
            size_bytes,
            storage_name,
            None,
        )
        .inspect_err(|_| {
            // Insert failed — remove blob to avoid orphaned files.
            let _ = std::fs::remove_file(&dest);
        })?;

    // ── 9. Emit event ─────────────────────────────────────────────────
    events::emit(
        &state,
        events::ATTACHMENT_CREATED,
        json!({ "id": attachment.id, "task_id": attachment.task_id }),
    );

    Ok(attachment)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_removes_forbidden_chars() {
        assert_eq!(
            sanitize_filename("a/b\\c:d*e?f\"g<h>i|j"),
            "a_b_c_d_e_f_g_h_i_j"
        );
        assert_eq!(sanitize_filename("normal_file.txt"), "normal_file.txt");
        assert_eq!(sanitize_filename("foto.png"), "foto.png");
    }

    #[test]
    fn mime_from_ext_known_extensions() {
        let cases: &[(&str, &str)] = &[
            ("photo.png", "image/png"),
            ("photo.PNG", "image/png"),
            ("doc.pdf", "application/pdf"),
            ("notes.txt", "text/plain"),
            ("readme.md", "text/markdown"),
            ("data.json", "application/json"),
            ("archive.zip", "application/zip"),
            ("image.jpg", "image/jpeg"),
            ("image.jpeg", "image/jpeg"),
            ("img.gif", "image/gif"),
            ("img.webp", "image/webp"),
            ("icon.svg", "image/svg+xml"),
            ("table.csv", "text/csv"),
            ("blob.bin", "application/octet-stream"),
            ("no_extension", "application/octet-stream"),
        ];
        for (name, expected_mime) in cases {
            assert_eq!(
                mime_from_ext(Path::new(name)),
                *expected_mime,
                "failed for {name}",
            );
        }
    }
}
