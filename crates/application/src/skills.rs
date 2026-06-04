//! Skills use case.
//!
//! Wave-E2.x (Round 6 back-fill). Mirrors `RolesUseCase`. UNIQUE(name)
//! maps to `AppError::Conflict { entity: "skill", … }`.
//!
//! SKILL-S10: adds file + git attachments. The use case owns the
//! per-skill blob directory layout
//! (`<app_data_dir>/skills/<skill_id>/<storage_path>`) and the
//! cross-cutting cleanup hook that fires on skill deletion. The
//! handler resolves `app_data_dir` from `AppState` and passes it in,
//! which keeps the use case decoupled from Tauri.

use std::path::{Path, PathBuf};

use catique_domain::{Skill, SkillAttachment, SkillAttachmentKind};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        skill_attachments::{
            self as att_repo, FileAttachmentDraft, GitAttachmentDraft,
            SkillAttachmentKind as RepoKind, SkillAttachmentRow,
        },
        skill_steps::{self as step_repo, SkillStepRow},
        skills::{self as repo, SkillDraft, SkillPatch, SkillRow},
    },
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// Maximum on-disk blob size we accept for a single skill attachment
/// (10 MiB). Mirrors the `task_attachments` budget; the storage cost is
/// the same regardless of the parent entity.
const MAX_FILE_SIZE_BYTES: i64 = 10 * 1024 * 1024;

/// Skills use case.
pub struct SkillsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> SkillsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every skill, ordered by position then name.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Skill>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_skill).collect())
    }

    /// Look up a skill by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Skill, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_skill(row)),
            None => Err(AppError::NotFound {
                entity: "skill".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Serialise a skill (overview + ordered steps) as a Markdown
    /// document.
    ///
    /// Stream J / v3 Wave 4. The format mirrors what
    /// `SkillImportUseCase::import_from_url` accepts, so a
    /// HUB-authored export round-trips through the import pipeline
    /// without surprises. The frontend `<SkillExportButton/>` used to
    /// build this string in JS; centralising it here keeps the export
    /// canonical (a future "share via signed git URL" can hash the
    /// exact same bytes) and avoids subtle JS/Rust divergence on
    /// whitespace handling.
    ///
    /// Shape:
    ///
    /// ```text
    /// # <skill name>
    ///
    /// <description, when non-empty>
    ///
    /// ## Step 1 — <title>
    ///
    /// <body, when non-empty>
    ///
    /// **Expected outcome.** <expected_outcome, when non-empty>
    /// ```
    ///
    /// Trailing whitespace is trimmed off each free-form section so
    /// the output stays stable across editor-flavoured paste paths;
    /// inter-section blank lines come from `writeln!` calls so a
    /// single missing field never collapses two adjacent sections
    /// into one paragraph.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `skill_id` is unknown.
    /// * Forwards every storage-layer error from the repo lookups.
    pub fn export_skill_as_markdown(&self, skill_id: &str) -> Result<String, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let skill_row = repo::get_by_id(&conn, skill_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "skill".into(),
                id: skill_id.to_owned(),
            })?;
        let steps = step_repo::list_by_skill(&conn, skill_id).map_err(map_db_err)?;
        Ok(render_skill_markdown(&skill_row, &steps))
    }

    /// Create a skill.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name / bad colour;
    /// `AppError::Conflict` for UNIQUE(name) collisions.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        description: Option<String>,
        color: Option<String>,
        position: f64,
    ) -> Result<Skill, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &SkillDraft {
                name: trimmed,
                description,
                color,
                position,
            },
        )
        .map_err(|e| map_db_err_unique(e, "skill"))?;
        Ok(row_to_skill(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id missing.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        description: Option<Option<String>>,
        color: Option<Option<String>>,
        position: Option<f64>,
    ) -> Result<Skill, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = SkillPatch {
            name: name.map(|n| n.trim().to_owned()),
            description,
            color,
            position,
        };
        match repo::update(&conn, &id, &patch).map_err(|e| map_db_err_unique(e, "skill"))? {
            Some(row) => Ok(row_to_skill(row)),
            None => Err(AppError::NotFound {
                entity: "skill".into(),
                id,
            }),
        }
    }

    /// Delete a skill. Without `app_data_dir`, the row-cascade still
    /// fires (ON DELETE CASCADE wipes `skill_attachments`) but the
    /// per-skill blob directory is left in place — call
    /// [`Self::delete_with_blobs`] from the handler so the on-disk
    /// blobs are scrubbed too.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "skill".into(),
                id: id.to_owned(),
            })
        }
    }

    /// List every skill attached to a role (cat), ordered by the
    /// `role_skills.position` column. Returns an empty `Vec` for roles
    /// with no attached skills — no `NotFound`, since the role-detail
    /// view legitimately renders an empty section.
    ///
    /// ctq-117.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_for_role(&self, role_id: &str) -> Result<Vec<Skill>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_for_role(&conn, role_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_skill).collect())
    }

    /// List every skill attached to a task, ordered by
    /// `task_skills.position`. Includes both direct and inherited rows.
    ///
    /// ctq-117.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_for_task(&self, task_id: &str) -> Result<Vec<Skill>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_for_task(&conn, task_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_skill).collect())
    }

    /// Attach a skill directly to a task. Idempotent: re-adding the
    /// same skill is a no-op (does not bump position, does not error).
    ///
    /// ctq-127.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation.
    pub fn add_to_task(
        &self,
        task_id: &str,
        skill_id: &str,
        position: f64,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::add_task_skill(&conn, task_id, skill_id, position).map_err(map_db_err)?;
        // Refactor-v3 D-B: bump the denormalised skill counter on the
        // affected task so kanban cards reflect the new attachment
        // without re-resolving the bundle.
        catique_infrastructure::db::repositories::tasks::recompute_effective_counts(&conn, task_id)
            .map_err(map_db_err)?;
        Ok(())
    }

    /// Detach a direct skill from a task. Returns `Ok(())` for idempotent
    /// removes (no row matched is **not** an error — matches role/skill
    /// detach semantics in the broader brief).
    ///
    /// ctq-127.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn remove_from_task(&self, task_id: &str, skill_id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let _ = repo::remove_task_skill(&conn, task_id, skill_id).map_err(map_db_err)?;
        // Refactor-v3 D-B counter sync.
        catique_infrastructure::db::repositories::tasks::recompute_effective_counts(&conn, task_id)
            .map_err(map_db_err)?;
        Ok(())
    }

    /// Delete a skill and scrub its on-disk blob directory.
    ///
    /// The DB-level FK cascade clears `skill_attachments` rows; this
    /// method additionally removes
    /// `<app_data_dir>/skills/<skill_id>/`. Filesystem failure during
    /// the scrub is logged (via the error path) but does not roll back
    /// the DB delete — the row cascade has already committed by then.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown. Filesystem errors during
    /// the directory removal surface as
    /// [`AppError::TransactionRolledBack`] with a clarifying message,
    /// even though the DB part already committed — callers should treat
    /// this as a non-fatal post-condition warning.
    pub fn delete_with_blobs(&self, id: &str, app_data_dir: &Path) -> Result<(), AppError> {
        self.delete(id)?;
        let dir = skill_dir(app_data_dir, id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| AppError::TransactionRolledBack {
                reason: format!("skill row deleted but blob dir scrub failed: {e}"),
            })?;
        }
        Ok(())
    }

    /// Persist a file blob under the per-skill directory and insert the
    /// metadata row. Mirrors `upload_attachment` for the task path.
    ///
    /// On insert failure the partially-written blob is removed to avoid
    /// orphans.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `skill_id` does not exist.
    /// * `AppError::Validation` — empty filename / mime, oversized
    ///   payload, filesystem I/O failure.
    /// * `AppError::TransactionRolledBack` — storage error after the
    ///   blob landed on disk.
    #[allow(clippy::needless_pass_by_value)]
    pub fn add_file_attachment(
        &self,
        skill_id: &str,
        filename: String,
        mime_type: String,
        bytes: Vec<u8>,
        app_data_dir: &Path,
    ) -> Result<SkillAttachment, AppError> {
        let trimmed_filename = validate_non_empty("filename", &filename)?;
        let trimmed_mime = validate_non_empty("mime_type", &mime_type)?;
        let size_bytes = i64::try_from(bytes.len()).map_err(|_| AppError::Validation {
            field: "bytes".into(),
            reason: "payload too large to address as i64".into(),
        })?;
        if size_bytes > MAX_FILE_SIZE_BYTES {
            return Err(AppError::Validation {
                field: "bytes".into(),
                reason: format!("must be ≤ {MAX_FILE_SIZE_BYTES} bytes"),
            });
        }

        let conn = acquire(self.pool).map_err(map_db_err)?;
        ensure_skill_exists(&conn, skill_id)?;

        // Resolve target dir + storage filename. We embed the id prefix
        // into the storage filename so multiple uploads with the same
        // original filename don't collide on disk.
        let storage_id = nanoid::nanoid!();
        let sanitized = sanitize_filename_segment(&trimmed_filename);
        let storage_name = format!("{storage_id}_{sanitized}");
        let target_dir = skill_dir(app_data_dir, skill_id);
        std::fs::create_dir_all(&target_dir).map_err(|e| AppError::Validation {
            field: "target_data_dir".into(),
            reason: format!("failed to create skill attachment directory: {e}"),
        })?;
        let dest = target_dir.join(&storage_name);

        // Atomic-rename: write to `<dest>.tmp`, fsync the bytes, then
        // rename into place. This avoids leaving a half-written blob if
        // the process is killed mid-write.
        let tmp = target_dir.join(format!("{storage_name}.tmp"));
        write_tmp_then_rename(&tmp, &dest, &bytes)?;

        let row = att_repo::insert_file(
            &conn,
            &FileAttachmentDraft {
                skill_id: skill_id.to_owned(),
                filename: trimmed_filename,
                mime_type: trimmed_mime,
                size_bytes,
                storage_path: storage_name,
            },
        )
        .map_err(|e| {
            // Clean up the blob — the metadata insert failed, so the
            // file is now an orphan.
            let _ = std::fs::remove_file(&dest);
            map_db_err(e)
        })?;
        Ok(row_to_attachment(row))
    }

    /// Insert a git-kind attachment.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `skill_id` does not exist.
    /// * `AppError::Validation` — empty / unparseable `git_url`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn add_git_attachment(
        &self,
        skill_id: &str,
        git_url: String,
        git_ref: Option<String>,
        git_path: Option<String>,
    ) -> Result<SkillAttachment, AppError> {
        let trimmed_url = validate_non_empty("git_url", &git_url)?;
        // We accept any URL scheme so the renderer can decide whether
        // to clone via ssh / https / file. The parse itself is the
        // gatekeeper — empty / malformed strings are rejected here so
        // callers don't have to.
        url::Url::parse(&trimmed_url).map_err(|e| AppError::Validation {
            field: "git_url".into(),
            reason: format!("must be a valid URL: {e}"),
        })?;
        let normalized_ref = normalize_optional(git_ref);
        let normalized_path = normalize_optional(git_path);

        let conn = acquire(self.pool).map_err(map_db_err)?;
        ensure_skill_exists(&conn, skill_id)?;
        let row = att_repo::insert_git(
            &conn,
            &GitAttachmentDraft {
                skill_id: skill_id.to_owned(),
                git_url: trimmed_url,
                git_ref: normalized_ref,
                git_path: normalized_path,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_attachment(row))
    }

    /// Look up an attachment by id. Returns `NotFound` if missing.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — attachment id is unknown.
    pub fn get_attachment(&self, attachment_id: &str) -> Result<SkillAttachment, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match att_repo::get_by_id(&conn, attachment_id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_attachment(row)),
            None => Err(AppError::NotFound {
                entity: "skill_attachment".into(),
                id: attachment_id.to_owned(),
            }),
        }
    }

    /// Remove an attachment row. For file-kind rows the on-disk blob is
    /// also removed; the metadata row is the source of truth, so we
    /// resolve `storage_path` from the row before deleting it.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — attachment id is unknown.
    pub fn remove_attachment(
        &self,
        attachment_id: &str,
        app_data_dir: &Path,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = att_repo::get_by_id(&conn, attachment_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "skill_attachment".into(),
                id: attachment_id.to_owned(),
            })?;
        let removed = att_repo::delete(&conn, attachment_id).map_err(map_db_err)?;
        if !removed {
            return Err(AppError::NotFound {
                entity: "skill_attachment".into(),
                id: attachment_id.to_owned(),
            });
        }
        if row.kind == RepoKind::File {
            if let Some(path_segment) = row.storage_path {
                let blob = skill_dir(app_data_dir, &row.skill_id).join(path_segment);
                // best-effort; absence is fine (already gone) but a
                // real IO error during deletion surfaces upward.
                if blob.exists() {
                    std::fs::remove_file(&blob).map_err(|e| AppError::TransactionRolledBack {
                        reason: format!("attachment row deleted but blob removal failed: {e}"),
                    })?;
                }
            }
        }
        Ok(())
    }

    /// List every attachment for a skill, oldest first.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `skill_id` does not exist.
    pub fn list_attachments(&self, skill_id: &str) -> Result<Vec<SkillAttachment>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        ensure_skill_exists(&conn, skill_id)?;
        let rows = att_repo::list_by_skill(&conn, skill_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_attachment).collect())
    }
}

/// Build the Markdown body for a skill + its ordered steps.
///
/// Pure function — extracted so the export can be unit-tested without
/// a DB and so the eventual "share via git URL" path can hash exactly
/// the same bytes by constructing `SkillRow` + `Vec<SkillStepRow>`
/// from another source. Caller is responsible for providing the
/// steps already ordered by position (the repo's `list_by_skill`
/// guarantees this).
fn render_skill_markdown(skill: &SkillRow, steps: &[SkillStepRow]) -> String {
    use std::fmt::Write as _;
    let mut out = String::new();
    // `writeln!` into a `String` is infallible (the only error case
    // is allocation failure, which the std impl panics on already);
    // explicitly ignore the `Result` to keep clippy happy without
    // pulling `unwrap` into a code path that has no real failure
    // mode.
    let _ = writeln!(out, "# {}", skill.name);
    if let Some(desc) = skill.description.as_deref() {
        let trimmed = desc.trim();
        if !trimmed.is_empty() {
            let _ = writeln!(out);
            let _ = writeln!(out, "{trimmed}");
        }
    }
    for (idx, step) in steps.iter().enumerate() {
        let _ = writeln!(out);
        let _ = writeln!(out, "## Step {} — {}", idx + 1, step.title);
        let trimmed_body = step.body.trim();
        if !trimmed_body.is_empty() {
            let _ = writeln!(out);
            let _ = writeln!(out, "{trimmed_body}");
        }
        if let Some(eo) = step.expected_outcome.as_deref() {
            let trimmed_eo = eo.trim();
            if !trimmed_eo.is_empty() {
                let _ = writeln!(out);
                let _ = writeln!(out, "**Expected outcome.** {trimmed_eo}");
            }
        }
    }
    out
}

/// Resolve the per-skill blob directory.
fn skill_dir(app_data_dir: &Path, skill_id: &str) -> PathBuf {
    app_data_dir.join("skills").join(skill_id)
}

/// Reject path-separator and shell-metacharacter bytes from a filename
/// fragment. Same set as the task-attachment uploader so the two
/// codepaths are mutually intelligible.
fn sanitize_filename_segment(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect()
}

/// Trim a borrowed string; `None` if empty after trim. Use for the
/// optional git fields where the frontend may send `""` for "no value".
fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

fn ensure_skill_exists(conn: &rusqlite::Connection, skill_id: &str) -> Result<(), AppError> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM skills WHERE id = ?1",
            rusqlite::params![skill_id],
            |_| Ok(()),
        )
        .map(|()| true)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(other),
        })
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "skill".into(),
            id: skill_id.to_owned(),
        })
    }
}

/// Write `bytes` to `tmp`, then atomically rename to `dest`. On failure
/// the half-written tmp is cleaned up. The atomic rename guarantees
/// that consumers reading `dest` either see no file or the complete
/// payload — there is no half-state visible to the renderer.
fn write_tmp_then_rename(tmp: &Path, dest: &Path, bytes: &[u8]) -> Result<(), AppError> {
    std::fs::write(tmp, bytes).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        AppError::Validation {
            field: "bytes".into(),
            reason: format!("failed to write blob to tmp: {e}"),
        }
    })?;
    std::fs::rename(tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        AppError::Validation {
            field: "bytes".into(),
            reason: format!("failed to rename blob into place: {e}"),
        }
    })?;
    Ok(())
}

fn row_to_skill(row: SkillRow) -> Skill {
    Skill {
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color,
        position: row.position,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn row_to_attachment(row: SkillAttachmentRow) -> SkillAttachment {
    SkillAttachment {
        id: row.id,
        skill_id: row.skill_id,
        kind: match row.kind {
            RepoKind::File => SkillAttachmentKind::File,
            RepoKind::Git => SkillAttachmentKind::Git,
        },
        filename: row.filename,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        storage_path: row.storage_path,
        git_url: row.git_url,
        git_ref: row.git_ref,
        git_path: row.git_path,
        created_at: row.created_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;
    use tempfile::TempDir;

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        drop(conn);
        pool
    }

    fn fresh_pool_with_skill() -> (Pool, String) {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        let s = uc.create("Rust".into(), None, None, 0.0).unwrap();
        (pool, s.id)
    }

    #[test]
    fn create_with_bad_color_returns_validation() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc
            .create("S".into(), None, Some("not-a-color".into()), 0.0)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "color"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc.create("  ".into(), None, None, 0.0).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_name_returns_conflict() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        uc.create("Same".into(), None, None, 0.0).unwrap();
        match uc.create("Same".into(), None, None, 1.0).expect_err("c") {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        uc.create(
            "Rust".into(),
            Some("systems lang".into()),
            Some("#abcdef".into()),
            0.0,
        )
        .unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].description, Some("systems lang".into()));
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn get_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc.get("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }

    /// ctq-117: list_for_role on a role with no attached skills returns
    /// `Ok(empty_vec)` — the role-detail view legitimately renders an
    /// empty section rather than surfacing NotFound.
    #[test]
    fn list_for_role_empty_role_returns_empty_vec() {
        let pool = fresh_pool();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('r1','R1','',0,0)",
            [],
        )
        .unwrap();
        drop(conn);
        let uc = SkillsUseCase::new(&pool);
        let list = uc.list_for_role("r1").unwrap();
        assert!(list.is_empty());
    }

    /// ctq-117: a populated role exposes its skills in `role_skills`
    /// position order via the use-case path.
    #[test]
    fn list_for_role_returns_attached_skills_in_position_order() {
        let pool = fresh_pool();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('r1','R1','',0,0)",
            [],
        )
        .unwrap();
        drop(conn);
        let uc = SkillsUseCase::new(&pool);
        let s1 = uc.create("Alpha".into(), None, None, 0.0).unwrap();
        let s2 = uc.create("Bravo".into(), None, None, 0.0).unwrap();
        // Wire join rows through a fresh conn so position is explicit.
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO role_skills (role_id, skill_id, position) VALUES ('r1', ?1, 5.0)",
            rusqlite::params![s1.id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO role_skills (role_id, skill_id, position) VALUES ('r1', ?1, 1.0)",
            rusqlite::params![s2.id],
        )
        .unwrap();
        drop(conn);
        let list = uc.list_for_role("r1").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Bravo");
        assert_eq!(list[1].name, "Alpha");
    }

    /// ctq-127: re-adding the same skill is idempotent — count stays at
    /// one, position is **not** bumped.
    #[test]
    fn add_to_task_idempotent() {
        let pool = fresh_pool();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd','B','sp',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('co','bd','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd','co','sp-1','T',0,0,0);",
        )
        .unwrap();
        drop(conn);
        let uc = SkillsUseCase::new(&pool);
        let s = uc.create("Rust".into(), None, None, 0.0).unwrap();
        uc.add_to_task("t1", &s.id, 1.0).unwrap();
        uc.add_to_task("t1", &s.id, 999.0).unwrap();
        let list = uc.list_for_task("t1").unwrap();
        assert_eq!(list.len(), 1);
    }

    /// ctq-127: removing a skill that was never attached succeeds
    /// silently (idempotent contract — frontend can call remove without
    /// guarding on prior state).
    #[test]
    fn remove_from_task_missing_is_ok() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        // ghost → ghost: returns Ok(()), not NotFound — matches the
        // "remove non-existent" line item in ctq-127.
        uc.remove_from_task("ghost-task", "ghost-skill").unwrap();
    }

    // ── SKILL-S10 attachment tests ───────────────────────────────────

    #[test]
    fn add_file_attachment_writes_blob_and_inserts_row() {
        let (pool, skill_id) = fresh_pool_with_skill();
        let uc = SkillsUseCase::new(&pool);
        let tmp = TempDir::new().expect("tempdir");
        let payload = b"hello world".to_vec();
        let original_len = payload.len();

        let att = uc
            .add_file_attachment(
                &skill_id,
                "hello.txt".into(),
                "text/plain".into(),
                payload,
                tmp.path(),
            )
            .expect("add file attachment");

        assert_eq!(att.kind, SkillAttachmentKind::File);
        assert_eq!(
            att.size_bytes,
            Some(i64::try_from(original_len).expect("fits"))
        );
        let storage_name = att.storage_path.as_deref().expect("storage_path");
        let blob_path = tmp.path().join("skills").join(&skill_id).join(storage_name);
        assert!(blob_path.exists(), "blob should exist at {blob_path:?}");
        let on_disk = std::fs::read(&blob_path).expect("read blob");
        assert_eq!(on_disk.len(), original_len);
    }

    #[test]
    fn add_git_attachment_validates_url() {
        let (pool, skill_id) = fresh_pool_with_skill();
        let uc = SkillsUseCase::new(&pool);
        match uc
            .add_git_attachment(&skill_id, "not a url".into(), None, None)
            .expect_err("validation")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "git_url"),
            other => panic!("got {other:?}"),
        }
        // Empty trims to empty → also validation, but field is git_url
        // because validate_non_empty fires first.
        match uc
            .add_git_attachment(&skill_id, "   ".into(), None, None)
            .expect_err("validation")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "git_url"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn add_git_attachment_normalises_empty_optional_fields() {
        let (pool, skill_id) = fresh_pool_with_skill();
        let uc = SkillsUseCase::new(&pool);
        let att = uc
            .add_git_attachment(
                &skill_id,
                "https://example.com/r.git".into(),
                Some("   ".into()),
                Some(String::new()),
            )
            .expect("ok");
        assert!(att.git_ref.is_none());
        assert!(att.git_path.is_none());
    }

    #[test]
    fn add_attachment_unknown_skill_returns_not_found() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        let tmp = TempDir::new().unwrap();
        match uc
            .add_file_attachment(
                "ghost",
                "x.txt".into(),
                "text/plain".into(),
                b"x".to_vec(),
                tmp.path(),
            )
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
        match uc
            .add_git_attachment("ghost", "https://example.com/r.git".into(), None, None)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn remove_attachment_removes_row_and_blob() {
        let (pool, skill_id) = fresh_pool_with_skill();
        let uc = SkillsUseCase::new(&pool);
        let tmp = TempDir::new().unwrap();
        let att = uc
            .add_file_attachment(
                &skill_id,
                "hello.txt".into(),
                "text/plain".into(),
                b"hello".to_vec(),
                tmp.path(),
            )
            .unwrap();
        let blob_path = tmp
            .path()
            .join("skills")
            .join(&skill_id)
            .join(att.storage_path.clone().unwrap());
        assert!(blob_path.exists());

        uc.remove_attachment(&att.id, tmp.path()).expect("remove");
        assert!(!blob_path.exists(), "blob should be gone");
        // Second remove is a NotFound.
        match uc
            .remove_attachment(&att.id, tmp.path())
            .expect_err("second remove")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill_attachment"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn list_attachments_orders_by_created_at() {
        let (pool, skill_id) = fresh_pool_with_skill();
        let uc = SkillsUseCase::new(&pool);
        let tmp = TempDir::new().unwrap();
        let a = uc
            .add_file_attachment(
                &skill_id,
                "a.txt".into(),
                "text/plain".into(),
                b"a".to_vec(),
                tmp.path(),
            )
            .unwrap();
        // small sleep keeps the timestamps strictly increasing — without
        // it, the same wall-clock millisecond can pin both rows and the
        // tie-break is the id (a random nanoid), which would make the
        // ordering test flake. 2 ms is well under any test budget.
        std::thread::sleep(std::time::Duration::from_millis(2));
        let b = uc
            .add_git_attachment(&skill_id, "https://example.com/r.git".into(), None, None)
            .unwrap();
        let list = uc.list_attachments(&skill_id).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, a.id, "oldest first");
        assert_eq!(list[1].id, b.id);
        assert!(list[0].created_at <= list[1].created_at);
    }

    #[test]
    fn add_file_attachment_rejects_oversize_payload() {
        let (pool, skill_id) = fresh_pool_with_skill();
        let uc = SkillsUseCase::new(&pool);
        let tmp = TempDir::new().unwrap();
        // 10 MiB + 1 byte. `try_from` keeps clippy happy on 32-bit
        // targets — on a 64-bit host the conversion is infallible.
        let payload = vec![0u8; usize::try_from(MAX_FILE_SIZE_BYTES + 1).expect("fits")];
        match uc
            .add_file_attachment(
                &skill_id,
                "big.bin".into(),
                "application/octet-stream".into(),
                payload,
                tmp.path(),
            )
            .expect_err("oversize")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "bytes"),
            other => panic!("got {other:?}"),
        }
    }

    // ── Stream J / v3 Wave 4 — markdown export ───────────────────────

    #[test]
    fn export_skill_as_markdown_renders_overview_and_steps() {
        let (pool, skill_id) = fresh_pool_with_skill();
        // Patch the description + add two steps so we exercise every
        // optional branch in `render_skill_markdown`.
        let uc = SkillsUseCase::new(&pool);
        uc.update(
            skill_id.clone(),
            None,
            Some(Some("Systems language with strong type checks.".into())),
            None,
            None,
        )
        .unwrap();
        let steps_uc = crate::skill_steps::SkillStepsUseCase::new(&pool);
        steps_uc
            .add_step(
                &skill_id,
                "Install rustup".into(),
                "Visit rustup.rs and follow the installer.".into(),
                Some("`rustc --version` prints a version".into()),
                None,
            )
            .unwrap();
        steps_uc
            .add_step(
                &skill_id,
                "Create a project".into(),
                String::new(), // empty body — should be skipped
                None,          // no expected outcome
                None,
            )
            .unwrap();

        let md = uc.export_skill_as_markdown(&skill_id).expect("export ok");

        // Header + overview present.
        assert!(md.starts_with("# Rust"), "markdown starts with title: {md}");
        assert!(md.contains("Systems language with strong type checks."));
        // Step 1 carries all three sections.
        assert!(md.contains("## Step 1 — Install rustup"));
        assert!(md.contains("Visit rustup.rs and follow the installer."));
        assert!(md.contains("**Expected outcome.** `rustc --version` prints a version"));
        // Step 2: heading only — empty body / missing expected outcome
        // must not render the **Expected outcome.** label.
        assert!(md.contains("## Step 2 — Create a project"));
        let step2_offset = md.find("## Step 2").expect("step 2 header");
        assert!(
            !md[step2_offset..].contains("**Expected outcome."),
            "step 2 has no expected outcome section",
        );
    }

    #[test]
    fn export_skill_as_markdown_returns_not_found_for_ghost() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc.export_skill_as_markdown("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn export_skill_as_markdown_handles_skill_without_description_or_steps() {
        let (pool, skill_id) = fresh_pool_with_skill();
        let md = SkillsUseCase::new(&pool)
            .export_skill_as_markdown(&skill_id)
            .unwrap();
        // Only the title line + trailing newline; no blank intro
        // paragraph for the missing description, no `## Step` headers.
        assert_eq!(md, "# Rust\n");
    }

    #[test]
    fn delete_with_blobs_scrubs_skill_dir() {
        let (pool, skill_id) = fresh_pool_with_skill();
        let uc = SkillsUseCase::new(&pool);
        let tmp = TempDir::new().unwrap();
        uc.add_file_attachment(
            &skill_id,
            "a.txt".into(),
            "text/plain".into(),
            b"a".to_vec(),
            tmp.path(),
        )
        .unwrap();
        let dir = tmp.path().join("skills").join(&skill_id);
        assert!(dir.exists());
        uc.delete_with_blobs(&skill_id, tmp.path())
            .expect("delete with blobs");
        assert!(!dir.exists(), "skill blob dir should be gone");
        // Row-level cascade also wiped the attachments table — relisting
        // against the now-deleted skill returns NotFound.
        match uc
            .list_attachments(&skill_id)
            .expect_err("list after delete")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }
}
