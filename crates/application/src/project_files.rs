//! Project-file use case — disk-backed agent instruction files
//! (catique-2, rewrite of the former DB-backed `space_files`).
//!
//! A project (space) carries a `project_folder_path`. The agent
//! instruction files (`AGENTS.md`, `CLAUDE.md`, …) live *in that folder*
//! on disk — they are the same files the connected agents read, so there
//! is one source of truth. This use case:
//!
//!   * [`list`](ProjectFilesUseCase::list) — merges the filenames the
//!     connected providers declare ([`ClientProvider::project_agent_filenames`])
//!     with any other root-level `*.md` already in the folder, reading
//!     each one's content. Provider-expected names are listed even when
//!     they do not exist yet, so the owner can create them.
//!   * [`read`](ProjectFilesUseCase::read) — one file.
//!   * [`write`](ProjectFilesUseCase::write) — create or overwrite a
//!     file on disk (atomic).
//!   * [`delete`](ProjectFilesUseCase::delete) — remove a file.
//!
//! Filenames must be a single safe segment ending in `.md`. Anything
//! with a path separator, `..`, or a non-markdown extension is rejected
//! before it reaches the filesystem.

use std::io;
use std::path::PathBuf;

use catique_clients::all_providers;
use catique_domain::ProjectFile;
use catique_infrastructure::db::pool::{acquire, DbError, Pool};
use catique_infrastructure::project_files as fs_pf;
use rusqlite::OptionalExtension;

use crate::error::AppError;
use crate::error_map::map_db_err;

/// Cap on a written body — generous (256 KiB); these are instruction
/// files, not transcripts.
const MAX_CONTENT_BYTES: usize = 256 * 1024;

/// Use case wrapper. Cheap clone (pool is Arc-backed).
pub struct ProjectFilesUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> ProjectFilesUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every agent-instruction markdown file for a space: the
    /// provider-declared names (whether or not they exist) unioned with
    /// any other root-level `*.md` present in the folder. Provider-
    /// expected files sort first, then alphabetically.
    ///
    /// # Errors
    ///
    /// * [`AppError::NotFound`] (`entity = "space"`) — unknown space.
    /// * [`AppError::Validation`] (`field = "projectFolderPath"`) — the
    ///   space has no project folder configured.
    /// * filesystem errors as [`AppError::TransactionRolledBack`].
    pub fn list(&self, space_id: &str) -> Result<Vec<ProjectFile>, AppError> {
        let base = self.project_folder(space_id)?;
        let expected = expected_map();

        let mut names: Vec<String> = expected.iter().map(|(n, _)| n.clone()).collect();
        for name in fs_pf::list_markdown(&base).map_err(map_io_err)? {
            if !names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
                names.push(name);
            }
        }

        let mut out = Vec::with_capacity(names.len());
        for name in names {
            let entry = fs_pf::read(&base, &name).map_err(map_io_err)?;
            out.push(ProjectFile {
                expected_by: expected_by(&expected, &name),
                name: entry.name,
                content: entry.content,
                exists: entry.exists,
                updated_at: entry.updated_at,
            });
        }

        out.sort_by(|a, b| {
            a.expected_by
                .is_empty()
                .cmp(&b.expected_by.is_empty())
                .then_with(|| {
                    a.name
                        .to_ascii_lowercase()
                        .cmp(&b.name.to_ascii_lowercase())
                })
        });
        Ok(out)
    }

    /// Read one file by name.
    ///
    /// # Errors
    ///
    /// See [`list`](Self::list) plus [`AppError::Validation`] for an
    /// invalid filename.
    pub fn read(&self, space_id: &str, name: &str) -> Result<ProjectFile, AppError> {
        validate_name(name)?;
        let base = self.project_folder(space_id)?;
        let entry = fs_pf::read(&base, name).map_err(map_io_err)?;
        Ok(hydrate(entry))
    }

    /// Create or overwrite a file on disk (atomic).
    ///
    /// # Errors
    ///
    /// * [`AppError::Validation`] — invalid filename or over-size body.
    /// * [`AppError::NotFound`] — space / project folder missing.
    /// * filesystem errors as [`AppError::TransactionRolledBack`].
    pub fn write(
        &self,
        space_id: &str,
        name: &str,
        content: &str,
    ) -> Result<ProjectFile, AppError> {
        validate_name(name)?;
        if content.len() > MAX_CONTENT_BYTES {
            return Err(AppError::Validation {
                field: "content".into(),
                reason: format!("must be at most {MAX_CONTENT_BYTES} bytes"),
            });
        }
        let base = self.project_folder(space_id)?;
        let entry = fs_pf::write(&base, name, content).map_err(map_io_err)?;
        Ok(hydrate(entry))
    }

    /// Delete a file. No-op (still `Ok`) when the file is already absent.
    ///
    /// # Errors
    ///
    /// See [`write`](Self::write) (minus the body cap).
    pub fn delete(&self, space_id: &str, name: &str) -> Result<(), AppError> {
        validate_name(name)?;
        let base = self.project_folder(space_id)?;
        fs_pf::delete(&base, name).map_err(map_io_err)?;
        Ok(())
    }

    // -----------------------------------------------------------------
    // Helpers.
    // -----------------------------------------------------------------

    /// Resolve the absolute project folder for a space, surfacing typed
    /// errors when the space is unknown or has no folder configured.
    fn project_folder(&self, space_id: &str) -> Result<PathBuf, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row: Option<Option<String>> = conn
            .query_row(
                "SELECT project_folder_path FROM spaces WHERE id = ?1",
                rusqlite::params![space_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|e| map_db_err(DbError::Sqlite(e)))?;
        match row {
            None => Err(AppError::NotFound {
                entity: "space".into(),
                id: space_id.to_owned(),
            }),
            Some(path) => match path {
                Some(p) if !p.trim().is_empty() => Ok(PathBuf::from(p)),
                _ => Err(AppError::Validation {
                    field: "projectFolderPath".into(),
                    reason: "project folder is not set for this space".into(),
                }),
            },
        }
    }
}

/// Convert a filesystem entry into the domain `ProjectFile`, computing
/// which providers expect the filename.
fn hydrate(entry: fs_pf::ProjectFileEntry) -> ProjectFile {
    let expected = expected_map();
    ProjectFile {
        expected_by: expected_by(&expected, &entry.name),
        name: entry.name,
        content: entry.content,
        exists: entry.exists,
        updated_at: entry.updated_at,
    }
}

/// Build the `filename -> [provider id]` map from every provider that
/// declares project agent files. Filenames are de-duplicated
/// case-insensitively; matching provider ids accumulate.
fn expected_map() -> Vec<(String, Vec<String>)> {
    let mut map: Vec<(String, Vec<String>)> = Vec::new();
    for provider in all_providers() {
        for name in provider.project_agent_filenames() {
            if let Some(slot) = map.iter_mut().find(|(n, _)| n.eq_ignore_ascii_case(name)) {
                slot.1.push(provider.id().to_owned());
            } else {
                map.push(((*name).to_owned(), vec![provider.id().to_owned()]));
            }
        }
    }
    map
}

/// Provider ids that expect `name` (case-insensitive match).
fn expected_by(expected: &[(String, Vec<String>)], name: &str) -> Vec<String> {
    expected
        .iter()
        .filter(|(n, _)| n.eq_ignore_ascii_case(name))
        .flat_map(|(_, ids)| ids.clone())
        .collect()
}

/// Filename must be a single safe segment ending in `.md`.
fn validate_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    let invalid = trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || !trimmed.to_ascii_lowercase().ends_with(".md");
    if invalid {
        return Err(AppError::Validation {
            field: "name".into(),
            reason: "must be a markdown filename (e.g. AGENTS.md) with no path separators".into(),
        });
    }
    Ok(())
}

/// Map a filesystem error to a typed [`AppError`]. A missing folder is a
/// `NotFound`; an unsafe name (defence-in-depth — the use case validates
/// first) a `Validation`; everything else a generic failure.
#[allow(clippy::needless_pass_by_value)]
fn map_io_err(e: io::Error) -> AppError {
    match e.kind() {
        io::ErrorKind::NotFound => AppError::NotFound {
            entity: "project_folder".into(),
            id: e.to_string(),
        },
        io::ErrorKind::InvalidInput => AppError::Validation {
            field: "name".into(),
            reason: e.to_string(),
        },
        _ => AppError::TransactionRolledBack {
            reason: format!("filesystem error: {e}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;
    use tempfile::TempDir;

    fn pool_with_space(folder: Option<&str>) -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO spaces (id, name, prefix, position, created_at, updated_at, project_folder_path) \
             VALUES ('sp1','S','sp',0,0,0,?1)",
            rusqlite::params![folder],
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn list_includes_provider_expected_even_when_absent() {
        let dir = TempDir::new().unwrap();
        let pool = pool_with_space(Some(dir.path().to_str().unwrap()));
        let uc = ProjectFilesUseCase::new(&pool);
        let files = uc.list("sp1").unwrap();
        // AGENTS.md + CLAUDE.md are provider-expected; both listed.
        let agents = files.iter().find(|f| f.name == "AGENTS.md").unwrap();
        assert!(!agents.exists);
        assert!(!agents.expected_by.is_empty());
        assert!(files.iter().any(|f| f.name == "CLAUDE.md" && !f.exists));
    }

    #[test]
    fn write_then_read_persists_to_disk() {
        let dir = TempDir::new().unwrap();
        let pool = pool_with_space(Some(dir.path().to_str().unwrap()));
        let uc = ProjectFilesUseCase::new(&pool);
        uc.write("sp1", "AGENTS.md", "# rules").unwrap();
        // Read back through the use case…
        assert_eq!(uc.read("sp1", "AGENTS.md").unwrap().content, "# rules");
        // …and confirm it really hit the filesystem.
        assert_eq!(
            std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap(),
            "# rules"
        );
    }

    #[test]
    fn list_surfaces_foreign_markdown() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("README.md"), "hi").unwrap();
        let pool = pool_with_space(Some(dir.path().to_str().unwrap()));
        let uc = ProjectFilesUseCase::new(&pool);
        let files = uc.list("sp1").unwrap();
        let readme = files.iter().find(|f| f.name == "README.md").unwrap();
        assert!(readme.exists);
        assert!(readme.expected_by.is_empty());
    }

    #[test]
    fn no_folder_is_validation_error() {
        let pool = pool_with_space(None);
        let uc = ProjectFilesUseCase::new(&pool);
        match uc.list("sp1").expect_err("should fail") {
            AppError::Validation { field, .. } => assert_eq!(field, "projectFolderPath"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn unknown_space_is_not_found() {
        let pool = pool_with_space(Some("/tmp"));
        let uc = ProjectFilesUseCase::new(&pool);
        match uc.list("ghost").expect_err("should fail") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "space"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn bad_filename_rejected() {
        let dir = TempDir::new().unwrap();
        let pool = pool_with_space(Some(dir.path().to_str().unwrap()));
        let uc = ProjectFilesUseCase::new(&pool);
        assert!(uc.write("sp1", "notes.txt", "x").is_err());
        assert!(uc.write("sp1", "../escape.md", "x").is_err());
    }
}
