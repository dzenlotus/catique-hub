//! Tasks use case.
//!
//! Wave-E2.4 (Olga). Slug generation lives in the repository
//! (space-prefix + 6-char nanoid) — see `repositories::tasks`. The
//! use case validates inputs and pre-checks parent existence so
//! `NotFound` is typed.

use catique_domain::Task;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::tasks::{self as repo, TaskDraft, TaskPatch, TaskRow},
};
use rusqlite::params;

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// Tasks use case.
pub struct TasksUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> TasksUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every task.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Task>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_task).collect())
    }

    /// Look up a task by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Task, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_task(row)),
            None => Err(AppError::NotFound {
                entity: "task".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a task.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty title; `AppError::NotFound` for
    /// missing `board_id` / `column_id`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        board_id: String,
        column_id: String,
        title: String,
        description: Option<String>,
        position: f64,
    ) -> Result<Task, AppError> {
        let trimmed = validate_non_empty("title", &title)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // Pre-check parents so NotFound is typed (the schema would
        // raise a generic FK error otherwise).
        let board_exists: bool = conn
            .query_row(
                "SELECT 1 FROM boards WHERE id = ?1",
                params![board_id],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !board_exists {
            return Err(AppError::NotFound {
                entity: "board".into(),
                id: board_id,
            });
        }
        let column_exists: bool = conn
            .query_row(
                "SELECT 1 FROM columns WHERE id = ?1 AND board_id = ?2",
                params![column_id, board_id],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !column_exists {
            return Err(AppError::NotFound {
                entity: "column".into(),
                id: column_id,
            });
        }
        let row = repo::insert(
            &conn,
            &TaskDraft {
                board_id,
                column_id,
                title: trimmed,
                description,
                position,
                role_id: None,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_task(row))
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
        title: Option<String>,
        description: Option<Option<String>>,
        column_id: Option<String>,
        position: Option<f64>,
        role_id: Option<Option<String>>,
    ) -> Result<Task, AppError> {
        if let Some(t) = title.as_deref() {
            validate_non_empty("title", t)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = TaskPatch {
            title: title.map(|t| t.trim().to_owned()),
            description,
            column_id,
            position,
            role_id,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_task(row)),
            None => Err(AppError::NotFound {
                entity: "task".into(),
                id,
            }),
        }
    }

    /// Delete a task.
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
                entity: "task".into(),
                id: id.to_owned(),
            })
        }
    }
}

fn row_to_task(row: TaskRow) -> Task {
    Task {
        id: row.id,
        board_id: row.board_id,
        column_id: row.column_id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        position: row.position,
        role_id: row.role_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','C',0,0);",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn create_then_get() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "Title".into(), None, 1.0)
            .unwrap();
        let got = uc.get(&t.id).unwrap();
        assert_eq!(got, t);
    }

    #[test]
    fn create_with_missing_board_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("ghost".into(), "c1".into(), "T".into(), None, 1.0)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "board"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_missing_column_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("bd1".into(), "ghost".into(), "T".into(), None, 1.0)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "column"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn empty_title_returns_validation() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("bd1".into(), "c1".into(), "  ".into(), None, 1.0)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "title"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0)
            .unwrap();
        let updated = uc
            .update(t.id.clone(), Some("New".into()), None, None, None, None)
            .unwrap();
        assert_eq!(updated.title, "New");
        assert!((updated.position - 1.0).abs() < f64::EPSILON);
    }
}
