//! Spaces use case.
//!
//! Wave-E2.4 (Olga). Mirrors `BoardsUseCase`. Validation: non-empty
//! `name` (≤ 200 chars), `prefix` matches the schema CHECK
//! `[a-z0-9-]{1,10}` — we re-implement the check in Rust so the
//! `AppError::Validation` is friendlier than a raw constraint failure.

use catique_domain::Space;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::spaces::{self as repo, SpaceDraft, SpacePatch, SpaceRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty},
};

const PREFIX_MAX_LEN: usize = 10;

/// Spaces use case — borrows the application's connection pool.
pub struct SpacesUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> SpacesUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every space, ordered by `(position, name)`.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors (see `error_map`).
    pub fn list(&self) -> Result<Vec<Space>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_space).collect())
    }

    /// Look up a space by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound { entity: "space", … }` if missing.
    pub fn get(&self, id: &str) -> Result<Space, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_space(row)),
            None => Err(AppError::NotFound {
                entity: "space".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a space.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty `name` / malformed `prefix`,
    /// `AppError::Conflict` for UNIQUE(prefix) collisions.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        prefix: String,
        description: Option<String>,
        is_default: bool,
    ) -> Result<Space, AppError> {
        let trimmed_name = validate_non_empty("name", &name)?;
        validate_prefix(&prefix)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &SpaceDraft {
                name: trimmed_name,
                prefix,
                description,
                is_default,
                position: None,
            },
        )
        .map_err(|e| map_db_err_unique(e, "space"))?;
        Ok(row_to_space(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown; usual validation /
    /// constraint mappings.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        description: Option<Option<String>>,
        is_default: Option<bool>,
        position: Option<f64>,
    ) -> Result<Space, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = SpacePatch {
            name: name.map(|n| n.trim().to_owned()),
            description,
            is_default,
            position,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_space(row)),
            None => Err(AppError::NotFound {
                entity: "space".into(),
                id,
            }),
        }
    }

    /// Delete a space.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown; FK violation (boards
    /// still in this space) surfaces as `AppError::Conflict`.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(|e| map_db_err_unique(e, "space"))?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "space".into(),
                id: id.to_owned(),
            })
        }
    }
}

fn validate_prefix(prefix: &str) -> Result<(), AppError> {
    if prefix.is_empty() || prefix.len() > PREFIX_MAX_LEN {
        return Err(AppError::Validation {
            field: "prefix".into(),
            reason: "must be 1-10 characters".into(),
        });
    }
    let ok = prefix
        .as_bytes()
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-');
    if !ok {
        return Err(AppError::Validation {
            field: "prefix".into(),
            reason: "may contain only [a-z0-9-]".into(),
        });
    }
    Ok(())
}

fn row_to_space(row: SpaceRow) -> Space {
    Space {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        description: row.description,
        is_default: row.is_default,
        position: row.position,
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
        drop(conn);
        pool
    }

    #[test]
    fn create_with_bad_prefix_returns_validation() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let err = uc
            .create("S".into(), "BAD-CASE".into(), None, false)
            .expect_err("validation");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "prefix"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        match uc.create(String::new(), "abc".into(), None, false).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_prefix_returns_conflict() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        uc.create("A".into(), "abc".into(), None, false).unwrap();
        let err = uc
            .create("B".into(), "abc".into(), None, false)
            .expect_err("conflict");
        match err {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "space"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "space"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list_then_get() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let s = uc.create("S".into(), "sp".into(), None, false).unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        let got = uc.get(&s.id).unwrap();
        assert_eq!(got.id, s.id);
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let s = uc.create("S".into(), "sp".into(), None, false).unwrap();
        let updated = uc
            .update(s.id.clone(), Some("Renamed".into()), None, None, None)
            .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.prefix, "sp");
    }
}
