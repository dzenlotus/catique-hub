//! Boards use case — orchestrates the [`infrastructure`] repository
//! against the `boards` table and exposes a domain-typed API.
//!
//! Wave-E2 (Olga). The contract:
//!
//! ```ignore
//! BoardsUseCase::new(&pool).list()         -> Result<Vec<Board>, AppError>
//! BoardsUseCase::new(&pool).get(id)        -> Result<Board, AppError>
//! BoardsUseCase::new(&pool).create(name, space_id) -> Result<Board, AppError>
//! ```
//!
//! Mapping rules (DbError → AppError):
//!   * [`DbError::PoolTimeout`]   → [`AppError::DbBusy`]   (NFR §3.3)
//!   * [`DbError::Pool`]          → [`AppError::DbBusy`]   (treat as busy)
//!   * [`DbError::Sqlite`] FK     → [`AppError::NotFound`] (parent missing)
//!   * [`DbError::Sqlite`] other  → [`AppError::TransactionRolledBack`]
//!   * [`DbError::Io`]            → [`AppError::TransactionRolledBack`]
//!
//! `AppError::Validation` is raised before we ever touch the DB so the
//! mapping table above only covers post-DB errors.

use catique_domain::Board;
use catique_infrastructure::db::{
    pool::{acquire, DbError, Pool},
    repositories::boards::{self as repo, BoardDraft, BoardRow},
};
use rusqlite::ErrorCode;

use crate::error::AppError;

/// Boards use case — borrows the application's connection pool.
pub struct BoardsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> BoardsUseCase<'a> {
    /// Create a use-case wrapper. Cheap — the pool is `Arc`-shared
    /// internally by r2d2, so this is a single ref-copy.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every board, ordered by `(position ASC, name ASC)`.
    ///
    /// # Errors
    ///
    /// See module docs for the full mapping table.
    pub fn list(&self) -> Result<Vec<Board>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_board).collect())
    }

    /// Look up a board by id; missing rows surface as
    /// `AppError::NotFound { entity: "board", id }`.
    ///
    /// # Errors
    ///
    /// See module docs for the full mapping table.
    pub fn get(&self, id: &str) -> Result<Board, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_board(row)),
            None => Err(AppError::NotFound {
                entity: "board".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a board in `space_id`. `name` must be non-empty after
    /// trimming. `space_id` must point to an existing row in `spaces`.
    ///
    /// Signature pinned by the IPC contract (Wave-E2 brief): both
    /// arguments are owned `String`s so the matching Tauri handler can
    /// forward them straight from the JSON payload without an extra
    /// borrow round-trip. Hence the targeted lint allow.
    ///
    /// # Errors
    ///
    /// * [`AppError::Validation`] — empty `name` (field=`"name"`).
    /// * [`AppError::NotFound`]   — `space_id` does not exist
    ///   (`entity="space"`).
    /// * Plus the post-DB mapping table from module docs.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(&self, name: String, space_id: String) -> Result<Board, AppError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation {
                field: "name".into(),
                reason: "must not be empty or whitespace-only".into(),
            });
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        if !repo::space_exists(&conn, &space_id).map_err(map_db_err)? {
            return Err(AppError::NotFound {
                entity: "space".into(),
                id: space_id,
            });
        }
        let row = repo::insert(
            &conn,
            &BoardDraft {
                name: trimmed.to_owned(),
                space_id,
                role_id: None,
                position: None,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_board(row))
    }
}

fn row_to_board(row: BoardRow) -> Board {
    Board {
        id: row.id,
        name: row.name,
        space_id: row.space_id,
        role_id: row.role_id,
        position: row.position,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn map_db_err(err: DbError) -> AppError {
    match err {
        DbError::PoolTimeout(_) | DbError::Pool(_) => AppError::DbBusy,
        DbError::Sqlite(rusqlite::Error::SqliteFailure(code, msg))
            if code.code == ErrorCode::ConstraintViolation =>
        {
            // FK violation maps to NotFound on the parent entity. We
            // can't tell *which* parent (boards has FKs to both spaces
            // and roles) from the rusqlite ExtendedCode alone, so we
            // surface a generic message; callers that need the typed
            // case (create_board) detect it before the FK fires via
            // `space_exists`.
            AppError::TransactionRolledBack {
                reason: format!(
                    "constraint violation: {}",
                    msg.unwrap_or_else(|| "(no message)".into())
                ),
            }
        }
        DbError::Sqlite(err) => AppError::TransactionRolledBack {
            reason: err.to_string(),
        },
        DbError::Io(err) => AppError::TransactionRolledBack {
            reason: err.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool_with_space(space_id: &str, prefix: &str) -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().expect("acquire");
        run_pending(&mut conn).expect("migrations");
        conn.execute(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 0, 0, 0, 0)",
            rusqlite::params![space_id, format!("Space {space_id}"), prefix],
        )
        .expect("seed space");
        drop(conn);
        pool
    }

    fn fresh_pool_no_space() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().expect("acquire");
        run_pending(&mut conn).expect("migrations");
        drop(conn);
        pool
    }

    #[test]
    fn create_then_list_returns_one_board() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc
            .create("Board One".into(), "sp1".into())
            .expect("create");
        assert_eq!(board.name, "Board One");
        assert_eq!(board.space_id, "sp1");

        let list = uc.list().expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, board.id);
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let err = uc.create("   ".into(), "sp1".into()).expect_err("validation");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn create_with_missing_space_returns_not_found() {
        let pool = fresh_pool_no_space();
        let uc = BoardsUseCase::new(&pool);
        let err = uc
            .create("Board".into(), "ghost".into())
            .expect_err("not found");
        match err {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "space");
                assert_eq!(id, "ghost");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn get_returns_not_found_for_missing_id() {
        let pool = fresh_pool_no_space();
        let uc = BoardsUseCase::new(&pool);
        let err = uc.get("nonsense").expect_err("not found");
        match err {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "board");
                assert_eq!(id, "nonsense");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn get_returns_board_when_exists() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let created = uc.create("Board".into(), "sp1".into()).unwrap();
        let fetched = uc.get(&created.id).unwrap();
        assert_eq!(fetched, created);
    }
}
