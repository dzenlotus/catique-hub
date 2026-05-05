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

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use catique_application::{attachments::AttachmentsUseCase, AppError};
use catique_domain::Attachment;
use catique_infrastructure::paths::app_data_dir;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// Maximum attachment blob accepted by `upload_attachment_blob` (10 MiB).
/// Mirrors the application-layer cap in `AttachmentsUseCase::create`
/// (NFR §3.4 blob-budget). We re-check at the IPC boundary so a
/// rejection happens before we allocate the decoded buffer or touch
/// the filesystem — avoids spending I/O on payloads we'll refuse.
const MAX_BLOB_SIZE_BYTES: usize = 10 * 1024 * 1024;

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

/// IPC: delete an attachment metadata row **and** the on-disk blob.
///
/// Resolves the blob root (`$APPLOCALDATA/catique/attachments`) and
/// hands it to `AttachmentsUseCase::delete_with_blob` so the file is
/// removed in lock-step with the row. A missing file is logged but
/// does not fail the call — see the use-case doc for the idempotency
/// rationale.
///
/// # Errors
///
/// Forwards every error from `AttachmentsUseCase::delete_with_blob`.
/// `AppError::Validation` if the platform's app-data dir cannot be
/// resolved.
#[tauri::command]
pub async fn delete_attachment(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let uc = AttachmentsUseCase::new(&state.pool);
    let attachment = uc.get(&id)?;
    let data_root = app_data_dir().map_err(|reason| AppError::Validation {
        field: "target_data_dir".into(),
        reason: reason.to_owned(),
    })?;
    let blob_root = data_root.join("attachments");
    uc.delete_with_blob(&id, &blob_root)?;
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

// ── upload_attachment_blob ─────────────────────────────────────────────────

/// Core implementation of `upload_attachment_blob`. Extracted from the
/// Tauri-bound entry point so unit tests can drive the full path
/// (decode → write → insert) against a `tempfile::TempDir` data root
/// without spinning up a Tauri runtime.
fn upload_attachment_blob_inner(
    pool: &catique_infrastructure::db::pool::Pool,
    data_root: &Path,
    task_id: String,
    filename: String,
    content_b64: &str,
    mime: String,
) -> Result<Attachment, AppError> {
    // ── 1. Decode base64 ───────────────────────────────────────────────
    let bytes = B64.decode(content_b64.as_bytes()).map_err(|e| {
        // Note: we deliberately do not echo `content_b64` back in the
        // error string — base64 strings can be megabytes long, and the
        // `Display` impl of DecodeError already names the offending
        // byte position. Stays under the 1 KiB log-line budget.
        AppError::BadRequest {
            reason: format!("content_b64: invalid base64 ({e})"),
        }
    })?;

    // ── 2. Size cap ────────────────────────────────────────────────────
    // Reject before allocating the on-disk path so an agent that
    // accidentally tries to upload its model weights gets a quick NO.
    if bytes.len() > MAX_BLOB_SIZE_BYTES {
        return Err(AppError::BadRequest {
            reason: format!(
                "attachment exceeds {MAX_BLOB_SIZE_BYTES} bytes (got {})",
                bytes.len()
            ),
        });
    }

    // ── 3. Resolve target directory ────────────────────────────────────
    let target_dir = data_root.join("attachments").join(&task_id);
    std::fs::create_dir_all(&target_dir).map_err(|e| AppError::Validation {
        field: "target_data_dir".into(),
        reason: format!("failed to create attachment directory: {e}"),
    })?;

    // ── 4. Collision-safe storage filename ─────────────────────────────
    let attachment_id = nanoid::nanoid!();
    let sanitized = sanitize_filename(&filename);
    let storage_name = format!("{attachment_id}_{sanitized}");
    let dest = target_dir.join(&storage_name);
    let tmp = target_dir.join(format!("{storage_name}.tmp"));

    // ── 5. Atomic write: tmp + rename ──────────────────────────────────
    // Writing to `<dest>.tmp` first guarantees readers never see a
    // partial blob even if we crash mid-write — a leftover `.tmp` is
    // safe to garbage-collect (the row was never inserted yet, so the
    // resolver doesn't reference it). `std::fs::write` truncates +
    // closes; `std::fs::rename` is atomic on POSIX & atomic-replace on
    // Windows.
    if let Err(e) = std::fs::write(&tmp, &bytes) {
        // `write` may have created a zero-byte file before failing;
        // remove it so re-runs aren't blocked.
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Validation {
            field: "content_b64".into(),
            reason: format!("blob write failed: {e}"),
        });
    }
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Validation {
            field: "content_b64".into(),
            reason: format!("blob rename failed: {e}"),
        });
    }

    // ── 6. Insert metadata row ─────────────────────────────────────────
    // `i64::try_from` is safe here: bytes.len() ≤ MAX_BLOB_SIZE_BYTES
    // (10 MiB) which is far below i64::MAX. Using try_from + unwrap_or
    // keeps the cast Clippy-clean without a bare `as` cast.
    let size_bytes = i64::try_from(bytes.len()).unwrap_or(i64::MAX);
    let mime_resolved = if mime.trim().is_empty() {
        // Fallback when the agent omits the MIME type. We could infer
        // from the extension like `upload_attachment` does, but agents
        // usually know the content type they generated — this branch is
        // defensive, not a primary path.
        mime_from_ext(Path::new(&filename)).to_owned()
    } else {
        mime
    };
    let attachment = AttachmentsUseCase::new(pool)
        .create(
            task_id,
            filename,
            mime_resolved,
            size_bytes,
            storage_name,
            None,
        )
        .inspect_err(|_| {
            // Insert failed (NotFound for missing task, validation,
            // FK, …) — unlink the blob to keep the directory clean.
            // Failure of remove itself is logged but swallowed; the
            // E3 orphan-sweep will reconcile.
            if let Err(rm) = std::fs::remove_file(&dest) {
                eprintln!(
                    "[catique-hub] upload_attachment_blob: insert failed and \
                     blob cleanup at {} also failed: {rm}",
                    dest.display(),
                );
            }
        })?;

    Ok(attachment)
}

/// IPC: accept a base64-encoded blob from an MCP agent, write it
/// atomically to the task's attachment directory, and persist the
/// metadata row.
///
/// Companion to [`upload_attachment`] (which copies a path-based source
/// for desktop drag-drop). MCP agents don't have access to the local
/// filesystem in the way a desktop UI does — they publish bodies via
/// JSON, which means base64. Tauri's serde contract doesn't include a
/// first-class binary type; base64 is the conventional carrier.
///
/// MCP description: "Upload a file as a base64-encoded blob attached to
/// `task_id`. Maximum size 10 MiB after decode. Returns the persisted
/// `Attachment` record."
///
/// # Behaviour
///
/// 1. Decode `content_b64` (BadRequest on malformed input).
/// 2. Reject blobs larger than 10 MiB **before** touching the filesystem.
/// 3. Resolve `$APPLOCALDATA/catique/attachments/<task_id>/`; create it
///    if absent.
/// 4. Build a collision-safe storage filename `<id>_<sanitized_name>`.
/// 5. Write the bytes to `<storage>.tmp` and `rename(2)` into place —
///    POSIX rename is atomic on the same filesystem (Windows since
///    1903 honours the same semantic with `MoveFileExW`, which
///    `std::fs::rename` uses). Either readers see the prior state or
///    the fully-written final blob; never a partial write.
/// 6. Insert the metadata row (the use-case re-validates the size and
///    returns NotFound for missing `task_id`). On insert failure,
///    unlink the blob to avoid an orphan.
/// 7. Emit `attachment:created` so the UI refetches.
///
/// # Errors
///
/// * `AppError::BadRequest` — base64 decode failure or oversize blob;
///   the message includes the byte count so the agent can adjust.
/// * `AppError::Validation` — empty filename / mime / app-data dir
///   cannot be resolved / FS write failure.
/// * `AppError::NotFound` — `task_id` does not exist.
/// * Other `AppError` variants propagated from the use case.
#[tauri::command]
pub async fn upload_attachment_blob(
    state: State<'_, AppState>,
    task_id: String,
    filename: String,
    content_b64: String,
    mime: String,
) -> Result<Attachment, AppError> {
    let data_root = app_data_dir().map_err(|reason| AppError::Validation {
        field: "target_data_dir".into(),
        reason: reason.to_owned(),
    })?;
    let attachment = upload_attachment_blob_inner(
        &state.pool,
        &data_root,
        task_id,
        filename,
        &content_b64,
        mime,
    )?;
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

    /// Build an in-memory pool with one task `t1` so the use-case
    /// `create` path has a parent to FK against. Mirrors the fixture
    /// in `crates/application/src/attachments.rs`.
    fn fresh_pool_with_task() -> catique_infrastructure::db::pool::Pool {
        use catique_infrastructure::db::pool::memory_pool_for_tests;
        use catique_infrastructure::db::runner::run_pending;
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd1','c1','sp-1','T',0,0,0);",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn upload_blob_happy_path_writes_file_and_inserts_row() {
        let pool = fresh_pool_with_task();
        let data_root = tempfile::tempdir().unwrap();
        let payload = b"hello, blob world";
        let b64 = B64.encode(payload);

        let attachment = upload_attachment_blob_inner(
            &pool,
            data_root.path(),
            "t1".into(),
            "note.txt".into(),
            &b64,
            "text/plain".into(),
        )
        .expect("upload should succeed");

        // Metadata round-trips.
        assert_eq!(attachment.task_id, "t1");
        assert_eq!(attachment.filename, "note.txt");
        assert_eq!(attachment.mime_type, "text/plain");
        assert_eq!(
            attachment.size_bytes,
            i64::try_from(payload.len()).unwrap()
        );

        // Blob is on disk at <root>/attachments/t1/<storage_path>.
        let blob_path = data_root
            .path()
            .join("attachments")
            .join("t1")
            .join(&attachment.storage_path);
        let on_disk = std::fs::read(&blob_path).expect("blob present");
        assert_eq!(on_disk, payload, "stored blob must match input bytes");

        // No leftover .tmp file from the rename.
        let tmp = blob_path.with_extension("tmp");
        assert!(
            !tmp.exists(),
            ".tmp shadow file must be cleaned up by the rename"
        );
    }

    #[test]
    fn upload_blob_rejects_invalid_base64() {
        let pool = fresh_pool_with_task();
        let data_root = tempfile::tempdir().unwrap();

        let err = upload_attachment_blob_inner(
            &pool,
            data_root.path(),
            "t1".into(),
            "x.txt".into(),
            "not!!!base64@@@",
            "text/plain".into(),
        )
        .expect_err("must reject malformed base64");
        match err {
            AppError::BadRequest { reason } => {
                assert!(
                    reason.contains("invalid base64"),
                    "unexpected reason: {reason}"
                );
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn upload_blob_rejects_oversize_with_explicit_size_info() {
        // Build a payload that decodes to MAX + 1 bytes so the size
        // gate fires. base64 expands ~33%, so the encoded string is
        // 14 MiB-ish — well within criterion budget.
        let pool = fresh_pool_with_task();
        let data_root = tempfile::tempdir().unwrap();

        let payload = vec![0u8; MAX_BLOB_SIZE_BYTES + 1];
        let b64 = B64.encode(&payload);

        let err = upload_attachment_blob_inner(
            &pool,
            data_root.path(),
            "t1".into(),
            "huge.bin".into(),
            &b64,
            "application/octet-stream".into(),
        )
        .expect_err("must reject oversize");
        match err {
            AppError::BadRequest { reason } => {
                assert!(reason.contains("exceeds"));
                assert!(
                    reason.contains(&MAX_BLOB_SIZE_BYTES.to_string()),
                    "reason must include the size cap so agents can adjust: {reason}"
                );
                assert!(
                    reason.contains(&payload.len().to_string()),
                    "reason must include the actual size: {reason}"
                );
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }

        // No file should have been written — the size gate is before
        // the FS write.
        let task_dir = data_root.path().join("attachments").join("t1");
        if task_dir.exists() {
            let entries: Vec<_> = std::fs::read_dir(&task_dir)
                .unwrap()
                .filter_map(Result::ok)
                .collect();
            assert!(
                entries.is_empty(),
                "no blob should be on disk after oversize rejection"
            );
        }
    }

    #[test]
    fn upload_blob_returns_not_found_for_missing_task_and_cleans_blob() {
        // The FS write happens before the DB INSERT (we need the
        // storage path to insert). On insert failure we must remove
        // the orphan blob — assert the cleanup path.
        let pool = fresh_pool_with_task();
        let data_root = tempfile::tempdir().unwrap();
        let b64 = B64.encode(b"hi");

        let err = upload_attachment_blob_inner(
            &pool,
            data_root.path(),
            "ghost-task".into(),
            "x.txt".into(),
            &b64,
            "text/plain".into(),
        )
        .expect_err("nf");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("expected NotFound, got {other:?}"),
        }

        // The handler's FS-cleanup branch must have removed the blob.
        let task_dir = data_root.path().join("attachments").join("ghost-task");
        if task_dir.exists() {
            let entries: Vec<_> = std::fs::read_dir(&task_dir)
                .unwrap()
                .filter_map(Result::ok)
                .collect();
            assert!(
                entries.is_empty(),
                "blob must be cleaned up after insert failure"
            );
        }
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
