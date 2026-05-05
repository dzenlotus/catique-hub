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

    /// List every skill attached to a role (cat), ordered by the
    /// `role_skills.position` column. Returns an empty `Vec` for roles
    /// with no attached skills — no `NotFound`, since the role-detail
    /// view legitimately renders an empty section.
    ///
    /// ctq-117.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_for_role(&self, role_id: &str) -> Result<Vec<Skill>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_for_role(&conn, role_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_skill).collect())
    }

    /// List every skill attached to a task, ordered by
    /// `task_skills.position`. Includes both direct and inherited rows.
    ///
    /// ctq-117.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_for_task(&self, task_id: &str) -> Result<Vec<Skill>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_for_task(&conn, task_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_skill).collect())
    }

    /// Attach a skill directly to a task. Idempotent: re-adding the
    /// same skill is a no-op (does not bump position, does not error).
    ///
    /// ctq-127.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation.
    pub fn add_to_task(
        &self,
        task_id: &str,
        skill_id: &str,
        position: f64,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::add_task_skill(&conn, task_id, skill_id, position).map_err(map_db_err)
    }

    /// Detach a direct skill from a task. Returns `Ok(())` for idempotent
    /// removes (no row matched is **not** an error — matches role/skill
    /// detach semantics in the broader brief).
    ///
    /// ctq-127.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn remove_from_task(&self, task_id: &str, skill_id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let _ = repo::remove_task_skill(&conn, task_id, skill_id).map_err(map_db_err)?;
        Ok(())
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

    /// ctq-117: list_for_role on a role with no attached skills returns
    /// `Ok(empty_vec)` — the role-detail view legitimately renders an
    /// empty section rather than surfacing NotFound.
    #[test]
    fn list_for_role_empty_role_returns_empty_vec() {
        let pool = fresh_pool();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('r1','R1','',0,0)",
            [],
        )
        .unwrap();
        drop(conn);
        let uc = SkillsUseCase::new(&pool);
        let list = uc.list_for_role("r1").unwrap();
        assert!(list.is_empty());
    }

    /// ctq-117: a populated role exposes its skills in `role_skills`
    /// position order via the use-case path.
    #[test]
    fn list_for_role_returns_attached_skills_in_position_order() {
        let pool = fresh_pool();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('r1','R1','',0,0)",
            [],
        )
        .unwrap();
        drop(conn);
        let uc = SkillsUseCase::new(&pool);
        let s1 = uc.create("Alpha".into(), None, None, 0.0).unwrap();
        let s2 = uc.create("Bravo".into(), None, None, 0.0).unwrap();
        // Wire join rows through a fresh conn so position is explicit.
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO role_skills (role_id, skill_id, position) VALUES ('r1', ?1, 5.0)",
            rusqlite::params![s1.id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO role_skills (role_id, skill_id, position) VALUES ('r1', ?1, 1.0)",
            rusqlite::params![s2.id],
        )
        .unwrap();
        drop(conn);
        let list = uc.list_for_role("r1").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Bravo");
        assert_eq!(list[1].name, "Alpha");
    }

    /// ctq-127: re-adding the same skill is idempotent — count stays at
    /// one, position is **not** bumped.
    #[test]
    fn add_to_task_idempotent() {
        let pool = fresh_pool();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd','B','sp',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('co','bd','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd','co','sp-1','T',0,0,0);",
        )
        .unwrap();
        drop(conn);
        let uc = SkillsUseCase::new(&pool);
        let s = uc.create("Rust".into(), None, None, 0.0).unwrap();
        uc.add_to_task("t1", &s.id, 1.0).unwrap();
        uc.add_to_task("t1", &s.id, 999.0).unwrap();
        let list = uc.list_for_task("t1").unwrap();
        assert_eq!(list.len(), 1);
    }

    /// ctq-127: removing a skill that was never attached succeeds
    /// silently (idempotent contract — frontend can call remove without
    /// guarding on prior state).
    #[test]
    fn remove_from_task_missing_is_ok() {
        let pool = fresh_pool();
        let uc = SkillsUseCase::new(&pool);
        // ghost → ghost: returns Ok(()), not NotFound — matches the
        // "remove non-existent" line item in ctq-127.
        uc.remove_from_task("ghost-task", "ghost-skill").unwrap();
    }
}
