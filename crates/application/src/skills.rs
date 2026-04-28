//! Skills use case.
//!
//! Wave-E2.x (Round 6 back-fill). Mirrors `RolesUseCase`. UNIQUE(name)
//! maps to `AppError::Conflict { entity: "skill", … }`.

use catique_domain::Skill;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::skills::{self as repo, SkillDraft, SkillPatch, SkillRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// Skills use case.
pub struct SkillsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> SkillsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every skill, ordered by position then name.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Skill>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_skill).collect())
    }

    /// Look up a skill by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Skill, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_skill(row)),
            None => Err(AppError::NotFound {
                entity: "skill".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a skill.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name / bad colour;
    /// `AppError::Conflict` for UNIQUE(name) collisions.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        description: Option<String>,
        color: Option<String>,
        position: f64,
    ) -> Result<Skill, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &SkillDraft {
                name: trimmed,
                description,
                color,
                position,
            },
        )
        .map_err(|e| map_db_err_unique(e, "skill"))?;
        Ok(row_to_skill(row))
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
        description: Option<Option<String>>,
        color: Option<Option<String>>,
        position: Option<f64>,
    ) -> Result<Skill, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = SkillPatch {
            name: name.map(|n| n.trim().to_owned()),
            description,
            color,
            position,
        };
        match repo::update(&conn, &id, &patch).map_err(|e| map_db_err_unique(e, "skill"))? {
            Some(row) => Ok(row_to_skill(row)),
            None => Err(AppError::NotFound {
                entity: "skill".into(),
                id,
            }),
        }
    }

    /// Delete a skill.
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
                entity: "skill".into(),
                id: id.to_owned(),
            })
        }
    }
}

fn row_to_skill(row: SkillRow) -> Skill {
    Skill {
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color,
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
    fn create_with_bad_color_returns_validation() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc
            .create("S".into(), None, Some("not-a-color".into()), 0.0)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "color"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc.create("  ".into(), None, None, 0.0).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_name_returns_conflict() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        uc.create("Same".into(), None, None, 0.0).unwrap();
        match uc.create("Same".into(), None, None, 1.0).expect_err("c") {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        uc.create(
            "Rust".into(),
            Some("systems lang".into()),
            Some("#abcdef".into()),
            0.0,
        )
        .unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].description, Some("systems lang".into()));
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn get_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        match uc.get("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }
}
