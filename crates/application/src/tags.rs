//! Tags use case.
//!
//! Wave-E2.4 (Olga). Tag autocomplete / search is deferred to E3.

use catique_domain::Tag;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::tags::{self as repo, TagDraft, TagPatch, TagRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// Tags use case.
pub struct TagsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> TagsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every tag.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Tag>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_tag).collect())
    }

    /// Look up a tag by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Tag, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_tag(row)),
            None => Err(AppError::NotFound {
                entity: "tag".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a tag.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name / bad colour;
    /// `AppError::Conflict` for UNIQUE(name) violation.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(&self, name: String, color: Option<String>) -> Result<Tag, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &TagDraft {
                name: trimmed,
                color,
            },
        )
        .map_err(|e| map_db_err_unique(e, "tag"))?;
        Ok(row_to_tag(row))
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
        color: Option<Option<String>>,
    ) -> Result<Tag, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = TagPatch {
            name: name.map(|n| n.trim().to_owned()),
            color,
        };
        match repo::update(&conn, &id, &patch).map_err(|e| map_db_err_unique(e, "tag"))? {
            Some(row) => Ok(row_to_tag(row)),
            None => Err(AppError::NotFound {
                entity: "tag".into(),
                id,
            }),
        }
    }

    /// Delete a tag.
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
                entity: "tag".into(),
                id: id.to_owned(),
            })
        }
    }
}

fn row_to_tag(row: TagRow) -> Tag {
    Tag {
        id: row.id,
        name: row.name,
        color: row.color,
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
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        match uc.create(String::new(), None).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_name_returns_conflict() {
        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        uc.create("dup".into(), None).unwrap();
        match uc.create("dup".into(), None).expect_err("c") {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "tag"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_get() {
        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        let t = uc.create("rust".into(), Some("#fed7aa".into())).unwrap();
        let got = uc.get(&t.id).unwrap();
        assert_eq!(got.name, "rust");
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "tag"),
            other => panic!("got {other:?}"),
        }
    }
}
