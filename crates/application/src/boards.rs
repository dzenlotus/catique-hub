//! Boards use case — orchestrates the [`infrastructure`] repository
//! against the `boards` table.
//!
//! Wave-E2.1 (Olga) shipped `list` / `get` / `create`. Wave-E2.4 adds
//! `update` and `delete` to round out the standard CRUD surface so the
//! IPC layer can expose the same five commands per entity.
//!
//! Mapping rules (DbError → AppError) live in `error_map.rs` and are
//! shared with the other use cases.

use catique_domain::Board;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::boards::{self as repo, BoardDraft, BoardPatch, BoardRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// Boards use case — borrows the application's connection pool.
pub struct BoardsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> BoardsUseCase<'a> {
    /// Construct a use-case wrapper. Cheap — pool is `Arc`-shared
    /// internally by r2d2.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every board, ordered by `(position ASC, name ASC)`.
    ///
    /// # Errors
    ///
    /// See `error_map::map_db_err`.
    pub fn list(&self) -> Result<Vec<Board>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_board).collect())
    }

    /// Look up a board by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound { entity: "board", id }` if missing.
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

    /// Create a board in `space_id`.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty `name`, `AppError::NotFound`
    /// for missing `space_id`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        space_id: String,
        description: Option<String>,
    ) -> Result<Board, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
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
                name: trimmed,
                space_id,
                role_id: None,
                position: None,
                description,
                // owner defaults to the seeded `maintainer-system`
                // row (Cat-as-Agent Phase 1 / memo Q1).
                owner_role_id: None,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_board(row))
    }

    /// Partial update.
    ///
    /// `description`: `None` = leave, `Some(None)` = clear, `Some(Some(s))` = set.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown; validation errors as
    /// usual.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        position: Option<f64>,
        role_id: Option<Option<String>>,
        description: Option<Option<String>>,
    ) -> Result<Board, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = BoardPatch {
            name: name.map(|n| n.trim().to_owned()),
            position,
            role_id,
            description,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_board(row)),
            None => Err(AppError::NotFound {
                entity: "board".into(),
                id,
            }),
        }
    }

    /// Delete a board.
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
                entity: "board".into(),
                id: id.to_owned(),
            })
        }
    }
}

fn row_to_board(row: BoardRow) -> Board {
    Board {
        id: row.id,
        name: row.name,
        space_id: row.space_id,
        role_id: row.role_id,
        position: row.position,
        description: row.description,
        created_at: row.created_at,
        updated_at: row.updated_at,
        owner_role_id: row.owner_role_id,
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
        let board = uc.create("Board One".into(), "sp1".into(), None).unwrap();
        assert_eq!(board.name, "Board One");
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, board.id);
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let err = uc
            .create("   ".into(), "sp1".into(), None)
            .expect_err("validation");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_missing_space_returns_not_found() {
        let pool = fresh_pool_no_space();
        let uc = BoardsUseCase::new(&pool);
        let err = uc
            .create("B".into(), "ghost".into(), None)
            .expect_err("not found");
        match err {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "space");
                assert_eq!(id, "ghost");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn get_returns_not_found_for_missing_id() {
        let pool = fresh_pool_no_space();
        let uc = BoardsUseCase::new(&pool);
        match uc.get("nonsense").expect_err("nf") {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "board");
                assert_eq!(id, "nonsense");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_renames_board() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create("Old".into(), "sp1".into(), None).unwrap();
        let updated = uc
            .update(board.id.clone(), Some("New".into()), None, None, None)
            .unwrap();
        assert_eq!(updated.name, "New");
    }

    #[test]
    fn update_returns_not_found_for_missing_id() {
        let pool = fresh_pool_no_space();
        let uc = BoardsUseCase::new(&pool);
        let err = uc
            .update("ghost".into(), Some("X".into()), None, None, None)
            .expect_err("nf");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "board"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_removes_board_then_not_found() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create("X".into(), "sp1".into(), None).unwrap();
        uc.delete(&board.id).unwrap();
        match uc.delete(&board.id).expect_err("second delete") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "board"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_description_persists() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc
            .create("Described".into(), "sp1".into(), Some("My desc".into()))
            .unwrap();
        assert_eq!(board.description, Some("My desc".to_owned()));
        let fetched = uc.get(&board.id).unwrap();
        assert_eq!(fetched.description, Some("My desc".to_owned()));
    }

    #[test]
    fn update_description_set_and_clear() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create("B".into(), "sp1".into(), None).unwrap();
        assert_eq!(board.description, None);

        let set = uc
            .update(
                board.id.clone(),
                None,
                None,
                None,
                Some(Some("desc".into())),
            )
            .unwrap();
        assert_eq!(set.description, Some("desc".to_owned()));

        let cleared = uc
            .update(board.id.clone(), None, None, None, Some(None))
            .unwrap();
        assert_eq!(cleared.description, None);
    }
}
