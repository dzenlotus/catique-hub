//! Columns use case.
//!
//! Wave-E2.4 (Olga). Mirrors `BoardsUseCase`. The schema's column FK
//! (`columns.board_id NOT NULL REFERENCES boards(id) ON DELETE
//! CASCADE`) means a missing board on insert produces `NotFound`.

use catique_domain::Column;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::columns::{self as repo, ColumnDraft, ColumnPatch, ColumnRow},
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
                entity: "column".into(),
                id: id.to_owned(),
            })
        }
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
}
