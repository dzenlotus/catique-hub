//! Roles use case.
//!
//! Wave-E2.4 (Olga). Mirrors the other use cases. UNIQUE(name) is
//! mapped to `AppError::Conflict { entity: "role", … }`.

use catique_domain::Role;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::roles::{self as repo, RoleDraft, RolePatch, RoleRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// Roles use case.
pub struct RolesUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> RolesUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every role, ordered by name.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Role>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_role).collect())
    }

    /// Look up a role by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Role, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_role(row)),
            None => Err(AppError::NotFound {
                entity: "role".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a role.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name / bad colour;
    /// `AppError::Conflict` for UNIQUE(name) collisions.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        content: String,
        color: Option<String>,
    ) -> Result<Role, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &RoleDraft {
                name: trimmed,
                content,
                color,
            },
        )
        .map_err(|e| map_db_err_unique(e, "role"))?;
        Ok(row_to_role(row))
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
        content: Option<String>,
        color: Option<Option<String>>,
    ) -> Result<Role, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = RolePatch {
            name: name.map(|n| n.trim().to_owned()),
            content,
            color,
        };
        match repo::update(&conn, &id, &patch).map_err(|e| map_db_err_unique(e, "role"))? {
            Some(row) => Ok(row_to_role(row)),
            None => Err(AppError::NotFound {
                entity: "role".into(),
                id,
            }),
        }
    }

    /// Delete a role.
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
                entity: "role".into(),
                id: id.to_owned(),
            })
        }
    }
}

fn row_to_role(row: RoleRow) -> Role {
    Role {
        id: row.id,
        name: row.name,
        content: row.content,
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
    fn create_with_bad_color_returns_validation() {
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        match uc
            .create("R".into(), String::new(), Some("not-a-color".into()))
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "color"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_name_returns_conflict() {
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        uc.create("Same".into(), String::new(), None).unwrap();
        match uc
            .create("Same".into(), String::new(), None)
            .expect_err("c")
        {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "role"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list() {
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        uc.create("R".into(), String::new(), Some("#abcdef".into()))
            .unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "role"),
            other => panic!("got {other:?}"),
        }
    }
}
