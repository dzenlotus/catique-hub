//! Agent reports use case.
//!
//! Wave-E2.4 (Olga). Search/filter is deferred to E3 — at this layer
//! we just shuttle rows in/out. The schema's
//! `agent_reports_fts_*` triggers populate the sibling FTS table
//! automatically.
//!
//! `kind` is intentionally a free-form `String` for now — adding a
//! Rust enum constraint would be a breaking change once the UI starts
//! relying on it. Promptery enumerates `investigation` / `analysis` /
//! `plan` / `summary` / `review` / `memo` informally.

use catique_domain::AgentReport;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::agent_reports::{
        self as repo, AgentReportDraft, AgentReportPatch, AgentReportRow,
    },
};
use rusqlite::params;

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// Reports use case.
pub struct ReportsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> ReportsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List agent-report rows (newest first).
    ///
    /// `task_id` is an optional filter. When `None`, every row is
    /// returned — preserving legacy callers' behaviour. When `Some`, the
    /// filter `task_id = ?1` is applied at the SQL layer using the
    /// `idx_agent_reports_task` index. The repository's `list_all` is
    /// untouched; the filtered query is issued in-place here so the
    /// minimal-change rule for the repository crate holds.
    ///
    /// MCP tool guidance: agents inspecting "what have I already
    /// reported on task X?" should always pass the `task_id` filter
    /// rather than scanning the global list.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self, task_id: Option<String>) -> Result<Vec<AgentReport>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match task_id {
            None => {
                let rows = repo::list_all(&conn).map_err(map_db_err)?;
                Ok(rows.into_iter().map(row_to_report).collect())
            }
            Some(tid) => {
                // SQL: `WHERE (?1 IS NULL OR task_id = ?1)` per spec.
                // Branch on `Option` outside the query — the `Some` arm
                // is the indexed path; the `None` arm reuses the
                // repository helper. Same end result either way.
                let mut stmt = conn
                    .prepare(
                        "SELECT id, task_id, kind, title, content, author, created_at, updated_at \
                         FROM agent_reports \
                         WHERE (?1 IS NULL OR task_id = ?1) \
                         ORDER BY created_at DESC",
                    )
                    .map_err(|e| {
                        map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e))
                    })?;
                let rows = stmt
                    .query_map(params![tid], |row| {
                        Ok(AgentReportRow {
                            id: row.get("id")?,
                            task_id: row.get("task_id")?,
                            kind: row.get("kind")?,
                            title: row.get("title")?,
                            content: row.get("content")?,
                            author: row.get("author")?,
                            created_at: row.get("created_at")?,
                            updated_at: row.get("updated_at")?,
                        })
                    })
                    .map_err(|e| {
                        map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e))
                    })?;
                let mut out = Vec::new();
                for r in rows {
                    out.push(row_to_report(r.map_err(|e| {
                        map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e))
                    })?));
                }
                Ok(out)
            }
        }
    }

    /// Look up a report by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<AgentReport, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_report(row)),
            None => Err(AppError::NotFound {
                entity: "agent_report".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a report.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty `title` / `kind`;
    /// `AppError::NotFound` for missing `task_id`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        task_id: String,
        kind: String,
        title: String,
        content: String,
        author: Option<String>,
    ) -> Result<AgentReport, AppError> {
        let trimmed_title = validate_non_empty("title", &title)?;
        let trimmed_kind = validate_non_empty("kind", &kind)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let task_exists: bool = conn
            .query_row(
                "SELECT 1 FROM tasks WHERE id = ?1",
                params![task_id],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !task_exists {
            return Err(AppError::NotFound {
                entity: "task".into(),
                id: task_id,
            });
        }
        let row = repo::insert(
            &conn,
            &AgentReportDraft {
                task_id,
                kind: trimmed_kind,
                title: trimmed_title,
                content,
                author,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_report(row))
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
        kind: Option<String>,
        title: Option<String>,
        content: Option<String>,
        author: Option<Option<String>>,
    ) -> Result<AgentReport, AppError> {
        if let Some(t) = title.as_deref() {
            validate_non_empty("title", t)?;
        }
        if let Some(k) = kind.as_deref() {
            validate_non_empty("kind", k)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = AgentReportPatch {
            kind: kind.map(|k| k.trim().to_owned()),
            title: title.map(|t| t.trim().to_owned()),
            content,
            author,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_report(row)),
            None => Err(AppError::NotFound {
                entity: "agent_report".into(),
                id,
            }),
        }
    }

    /// Delete a report.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id unknown.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "agent_report".into(),
                id: id.to_owned(),
            })
        }
    }
}

fn row_to_report(row: AgentReportRow) -> AgentReport {
    AgentReport {
        id: row.id,
        task_id: row.task_id,
        kind: row.kind,
        title: row.title,
        content: row.content,
        author: row.author,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool_with_task() -> Pool {
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
    fn create_with_missing_task_returns_not_found() {
        let pool = fresh_pool_with_task();
        let uc = ReportsUseCase::new(&pool);
        let err = uc
            .create(
                "ghost".into(),
                "summary".into(),
                "T".into(),
                "c".into(),
                None,
            )
            .expect_err("nf");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn empty_title_returns_validation() {
        let pool = fresh_pool_with_task();
        let uc = ReportsUseCase::new(&pool);
        let err = uc
            .create("t1".into(), "summary".into(), "  ".into(), "c".into(), None)
            .expect_err("v");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "title"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list() {
        let pool = fresh_pool_with_task();
        let uc = ReportsUseCase::new(&pool);
        uc.create("t1".into(), "plan".into(), "T".into(), "c".into(), None)
            .unwrap();
        let list = uc.list(None).unwrap();
        assert_eq!(list.len(), 1);
    }

    fn fresh_pool_with_two_tasks() -> Pool {
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
                 VALUES ('t1','bd1','c1','sp-1','T1',0,0,0), \
                        ('t2','bd1','c1','sp-2','T2',1,0,0);",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn list_with_task_id_filters_to_that_task() {
        let pool = fresh_pool_with_two_tasks();
        let uc = ReportsUseCase::new(&pool);
        let r1 = uc
            .create("t1".into(), "plan".into(), "T1".into(), "c".into(), None)
            .unwrap();
        let _r2 = uc
            .create("t2".into(), "plan".into(), "T2".into(), "c".into(), None)
            .unwrap();
        // Unfiltered: both rows.
        assert_eq!(uc.list(None).unwrap().len(), 2);
        // Filtered to t1: just r1.
        let only_t1 = uc.list(Some("t1".into())).unwrap();
        assert_eq!(only_t1.len(), 1);
        assert_eq!(only_t1[0].id, r1.id);
        // Filter to non-existent task: empty.
        assert!(uc.list(Some("ghost".into())).unwrap().is_empty());
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool_with_task();
        let uc = ReportsUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "agent_report"),
            other => panic!("got {other:?}"),
        }
    }
}
