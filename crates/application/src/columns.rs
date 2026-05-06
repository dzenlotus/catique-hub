//! Columns use case.
//!
//! Wave-E2.4 (Olga). Mirrors `BoardsUseCase`. The schema's column FK
//! (`columns.board_id NOT NULL REFERENCES boards(id) ON DELETE
//! CASCADE`) means a missing board on insert produces `NotFound`.

use catique_domain::Column;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::columns::{self as repo, ColumnDraft, ColumnPatch, ColumnRow},
    repositories::inheritance::{self as inh, InheritanceScope},
    repositories::tasks::{cascade_clear_scope, cascade_prompt_attachment, AttachScope},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// Columns use case.
pub struct ColumnsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> ColumnsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every column, ordered by `(board_id, position)`.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Column>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_column).collect())
    }

    /// Look up a column by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Column, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_column(row)),
            None => Err(AppError::NotFound {
                entity: "column".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a column.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name; `AppError::NotFound` for
    /// missing `board_id`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        board_id: String,
        name: String,
        position: i64,
    ) -> Result<Column, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        if !repo::board_exists(&conn, &board_id).map_err(map_db_err)? {
            return Err(AppError::NotFound {
                entity: "board".into(),
                id: board_id,
            });
        }
        let row = repo::insert(
            &conn,
            &ColumnDraft {
                board_id,
                name: trimmed,
                position,
                role_id: None,
                // IPC-created columns are never the default — migration
                // `016_*` stamps that flag once per board, and the
                // delete path refuses to drop a default column. Allowing
                // the IPC to mint extra defaults would break the
                // single-default invariant the resolver relies on.
                is_default: false,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_column(row))
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
        position: Option<i64>,
        role_id: Option<Option<String>>,
    ) -> Result<Column, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = ColumnPatch {
            name: name.map(|n| n.trim().to_owned()),
            position,
            role_id,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_column(row)),
            None => Err(AppError::NotFound {
                entity: "column".into(),
                id,
            }),
        }
    }

    /// Delete a column.
    ///
    /// Refuses to delete the board's mandatory default column
    /// (migration `016_default_board_naming_and_constraints.sql`):
    /// every board needs somewhere to land cross-board task moves, and
    /// the resolver assumes a default exists. The only legitimate way
    /// to drop a default column is to delete the owning board.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` if id is unknown.
    /// * `AppError::Forbidden` when the column is `is_default = 1`.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) if row.is_default => Err(AppError::Forbidden {
                reason: "default column cannot be deleted".into(),
            }),
            Some(_) => {
                let removed = repo::delete(&conn, id).map_err(map_db_err)?;
                if removed {
                    Ok(())
                } else {
                    // Race: deleted between get and delete.
                    Err(AppError::NotFound {
                        entity: "column".into(),
                        id: id.to_owned(),
                    })
                }
            }
            None => Err(AppError::NotFound {
                entity: "column".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Atomically replace the full ordered prompt list for a column.
    /// ADR-0006 / ctq-108. Mirrors `BoardsUseCase::set_board_prompts`
    /// — single immediate transaction wraps the join-table replace
    /// plus the resolver-side cascade.
    ///
    /// `prompt_ids` may be empty: clears the column's prompts in one
    /// round-trip. Position column is INTEGER on `column_prompts`
    /// (migration `001_initial.sql:224`).
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_column_prompts(
        &self,
        column_id: String,
        prompt_ids: Vec<String>,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;

        tx.execute(
            "DELETE FROM column_prompts WHERE column_id = ?1",
            rusqlite::params![column_id],
        )
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        let scope = AttachScope::Column(column_id.clone());
        cascade_clear_scope(&tx, &scope).map_err(map_db_err)?;

        for (idx, prompt_id) in prompt_ids.iter().enumerate() {
            // `try_from` guards against the theoretical 32-bit-host
            // edge case where `idx` could exceed `i64::MAX`; clamp via
            // `unwrap_or` keeps the signature infallible without a
            // panic path. Mirrors the cast strategy in
            // `BoardsUseCase::set_board_prompts`.
            let position_i = i64::try_from(idx).unwrap_or(i64::MAX) + 1;
            tx.execute(
                "INSERT INTO column_prompts (column_id, prompt_id, position) \
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![column_id, prompt_id, position_i],
            )
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
            #[allow(clippy::cast_precision_loss)]
            let position_f = position_i as f64;
            cascade_prompt_attachment(&tx, &scope, prompt_id, position_f).map_err(map_db_err)?;
        }

        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Replace the column's skill list with `skill_ids`. ctq-120.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn set_skills(&self, column_id: &str, skill_ids: &[String]) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        inh::set_skills(&mut conn, InheritanceScope::Column, column_id, skill_ids)
            .map_err(map_db_err)
    }

    /// Replace the column's MCP-tool list. ctq-120.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn set_mcp_tools(
        &self,
        column_id: &str,
        mcp_tool_ids: &[String],
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        inh::set_mcp_tools(
            &mut conn,
            InheritanceScope::Column,
            column_id,
            mcp_tool_ids,
        )
        .map_err(map_db_err)
    }
}

fn row_to_column(row: ColumnRow) -> Column {
    Column {
        id: row.id,
        board_id: row.board_id,
        name: row.name,
        position: row.position,
        role_id: row.role_id,
        created_at: row.created_at,
        is_default: row.is_default,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool_with_board() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0);",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn create_with_missing_board_returns_not_found() {
        let pool = fresh_pool_with_board();
        let uc = ColumnsUseCase::new(&pool);
        let err = uc.create("ghost".into(), "C".into(), 1).expect_err("nf");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "board"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list() {
        let pool = fresh_pool_with_board();
        let uc = ColumnsUseCase::new(&pool);
        let c = uc.create("bd1".into(), "Todo".into(), 1).unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, c.id);
    }

    #[test]
    fn delete_then_get_returns_not_found() {
        let pool = fresh_pool_with_board();
        let uc = ColumnsUseCase::new(&pool);
        let c = uc.create("bd1".into(), "X".into(), 1).unwrap();
        uc.delete(&c.id).unwrap();
        match uc.get(&c.id).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "column"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_refuses_default_column() {
        // D-006 / migration 016: a column flagged is_default = 1 must
        // never be removed via the IPC. The forbidden variant is
        // friendlier than the raw constraint failure.
        let pool = fresh_pool_with_board();
        // Mint a default column directly via the repo (the use-case
        // create() always passes is_default = false).
        let default_id = {
            let conn = acquire(&pool).unwrap();
            let row = repo::insert(
                &conn,
                &ColumnDraft {
                    board_id: "bd1".into(),
                    name: "Owner".into(),
                    position: 0,
                    role_id: None,
                    is_default: true,
                },
            )
            .unwrap();
            row.id
        };
        let uc = ColumnsUseCase::new(&pool);
        match uc.delete(&default_id).expect_err("forbidden") {
            AppError::Forbidden { reason } => {
                assert!(
                    reason.contains("default column"),
                    "unexpected reason: {reason}"
                );
            }
            other => panic!("expected Forbidden, got {other:?}"),
        }
        // The default column is still there.
        let got = uc.get(&default_id).unwrap();
        assert!(got.is_default);
    }

    #[test]
    fn delete_allows_non_default_column() {
        let pool = fresh_pool_with_board();
        let uc = ColumnsUseCase::new(&pool);
        let c = uc.create("bd1".into(), "Todo".into(), 1).unwrap();
        assert!(!c.is_default);
        uc.delete(&c.id).expect("non-default column deletes");
    }

    #[test]
    fn update_returns_not_found_for_missing_id() {
        let pool = fresh_pool_with_board();
        let uc = ColumnsUseCase::new(&pool);
        let err = uc
            .update("ghost".into(), Some("X".into()), None, None)
            .expect_err("nf");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "column"),
            other => panic!("got {other:?}"),
        }
    }

    // -----------------------------------------------------------------
    // ctq-108 — set_column_prompts bulk setter.
    // -----------------------------------------------------------------

    /// Seeds three prompts and one task in a column on the existing
    /// `bd1` board so the cascade has a target row to materialise into.
    fn seed_column_prompts_fixture() -> (Pool, String) {
        let pool = fresh_pool_with_board();
        let column = ColumnsUseCase::new(&pool)
            .create("bd1".into(), "Todo".into(), 1)
            .unwrap();
        {
            let conn = catique_infrastructure::db::pool::acquire(&pool).unwrap();
            conn.execute_batch(
                "INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p1','P1','',0,0), \
                     ('p2','P2','',0,0), \
                     ('p3','P3','',0,0);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd1',?1,'sp-1','T',0,0,0)",
                rusqlite::params![column.id],
            )
            .unwrap();
        }
        (pool, column.id)
    }

    #[test]
    fn set_column_prompts_replaces_ordering_and_cascades() {
        let (pool, column_id) = seed_column_prompts_fixture();
        let uc = ColumnsUseCase::new(&pool);

        uc.set_column_prompts(column_id.clone(), vec!["p1".into(), "p2".into()])
            .unwrap();
        uc.set_column_prompts(column_id.clone(), vec!["p3".into(), "p1".into()])
            .unwrap();

        let conn = catique_infrastructure::db::pool::acquire(&pool).unwrap();
        let ordered: Vec<String> = conn
            .prepare(
                "SELECT prompt_id FROM column_prompts \
                 WHERE column_id = ?1 ORDER BY position ASC",
            )
            .unwrap()
            .query_map(rusqlite::params![column_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(ordered, vec!["p3".to_string(), "p1".to_string()]);

        let mat: Vec<String> = conn
            .prepare(
                "SELECT prompt_id FROM task_prompts \
                 WHERE task_id = 't1' AND origin = ?1 ORDER BY prompt_id",
            )
            .unwrap()
            .query_map(rusqlite::params![format!("column:{column_id}")], |r| {
                r.get::<_, String>(0)
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(mat, vec!["p1".to_string(), "p3".to_string()]);
    }

    #[test]
    fn set_column_prompts_with_empty_clears_all() {
        let (pool, column_id) = seed_column_prompts_fixture();
        let uc = ColumnsUseCase::new(&pool);
        uc.set_column_prompts(column_id.clone(), vec!["p1".into(), "p2".into()])
            .unwrap();
        uc.set_column_prompts(column_id.clone(), Vec::new()).unwrap();

        let conn = catique_infrastructure::db::pool::acquire(&pool).unwrap();
        let join_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM column_prompts WHERE column_id = ?1",
                rusqlite::params![column_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(join_count, 0);
        let mat_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_prompts WHERE origin = ?1",
                rusqlite::params![format!("column:{column_id}")],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mat_count, 0);
    }

    #[test]
    fn set_column_prompts_atomic_on_fk_error() {
        let (pool, column_id) = seed_column_prompts_fixture();
        let uc = ColumnsUseCase::new(&pool);
        uc.set_column_prompts(column_id.clone(), vec!["p1".into()])
            .unwrap();

        let err = uc
            .set_column_prompts(
                column_id.clone(),
                vec!["p2".into(), "ghost".into(), "p3".into()],
            )
            .expect_err("FK violation");
        match err {
            AppError::TransactionRolledBack { .. } => {}
            other => panic!("expected TransactionRolledBack, got {other:?}"),
        }

        let conn = catique_infrastructure::db::pool::acquire(&pool).unwrap();
        let ids: Vec<String> = conn
            .prepare(
                "SELECT prompt_id FROM column_prompts \
                 WHERE column_id = ?1 ORDER BY position ASC",
            )
            .unwrap()
            .query_map(rusqlite::params![column_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(ids, vec!["p1".to_string()]);
    }
}
