//! Prompt-groups use case.
//!
//! Provides CRUD on `prompt_groups` plus member-list management via
//! `prompt_group_members`. No UNIQUE(name) constraint exists in the schema,
//! so duplicate names are allowed at the storage layer — validation is
//! limited to non-empty trimmed name and optional `#RRGGBB` colour.

use catique_domain::PromptGroup;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::prompt_groups::{
        self as repo, PromptGroupDraft, PromptGroupPatch, PromptGroupRow,
    },
};

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty, validate_optional_color},
};

/// Prompt-groups use case.
pub struct PromptGroupsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> PromptGroupsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every group, ordered by position then name.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<PromptGroup>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_group).collect())
    }

    /// Look up a group by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the id is absent.
    pub fn get(&self, id: &str) -> Result<PromptGroup, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_group(row)),
            None => Err(AppError::NotFound {
                entity: "prompt_group".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a group. `position` defaults to `0` when `None`.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name or bad colour.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        color: Option<String>,
        position: Option<i64>,
    ) -> Result<PromptGroup, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &PromptGroupDraft {
                name: trimmed,
                color,
                position: position.unwrap_or(0),
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_group(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the id is absent.
    /// `AppError::Validation` for empty name or bad colour.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        color: Option<Option<String>>,
        position: Option<i64>,
    ) -> Result<PromptGroup, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = PromptGroupPatch {
            name: name.map(|n| n.trim().to_owned()),
            color,
            position,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_group(row)),
            None => Err(AppError::NotFound {
                entity: "prompt_group".into(),
                id,
            }),
        }
    }

    /// Delete a group. The `ON DELETE CASCADE` on `prompt_group_members`
    /// removes member rows automatically.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the id is absent.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "prompt_group".into(),
                id: id.to_owned(),
            })
        }
    }

    // ------------------------------------------------------------------
    // Member management
    // ------------------------------------------------------------------

    /// Return ordered prompt ids for a group.
    ///
    /// Returns an empty vec (not NotFound) when the group has no members.
    /// The group itself is not validated to exist — the caller may check
    /// if needed.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_members(&self, group_id: &str) -> Result<Vec<String>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::list_members(&conn, group_id).map_err(map_db_err)
    }

    /// Add a prompt to a group. Upserts the position if already present.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation (unknown group or
    /// prompt id).
    #[allow(clippy::needless_pass_by_value)]
    pub fn add_member(
        &self,
        group_id: String,
        prompt_id: String,
        position: i64,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::add_member(&conn, &group_id, &prompt_id, position).map_err(map_db_err)
    }

    /// Remove a prompt from a group.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if no row matched.
    #[allow(clippy::needless_pass_by_value)]
    pub fn remove_member(&self, group_id: String, prompt_id: String) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::remove_member(&conn, &group_id, &prompt_id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "prompt_group_member".into(),
                id: format!("{group_id}|{prompt_id}"),
            })
        }
    }

    /// Atomically replace the complete ordered member list.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation (unknown prompt id).
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_members(
        &self,
        group_id: String,
        ordered_prompt_ids: Vec<String>,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::set_members(&conn, &group_id, &ordered_prompt_ids).map_err(map_db_err)
    }
}

fn row_to_group(row: PromptGroupRow) -> PromptGroup {
    PromptGroup {
        id: row.id,
        name: row.name,
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

    /// Insert a prompt directly so FK constraints on members are satisfied.
    fn seed_prompt(pool: &Pool, id: &str) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES (?1, ?2, '', 0, 0)",
            rusqlite::params![id, id],
        )
        .unwrap();
    }

    #[test]
    fn create_then_get() {
        let pool = fresh_pool();
        let uc = PromptGroupsUseCase::new(&pool);
        let group = uc.create("Grp".into(), None, None).unwrap();
        let got = uc.get(&group.id).unwrap();
        assert_eq!(group, got);
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = PromptGroupsUseCase::new(&pool);
        match uc.create("  ".into(), None, None).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_bad_color_returns_validation() {
        let pool = fresh_pool();
        let uc = PromptGroupsUseCase::new(&pool);
        match uc
            .create("G".into(), Some("not-a-color".into()), None)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "color"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list() {
        let pool = fresh_pool();
        let uc = PromptGroupsUseCase::new(&pool);
        uc.create("G1".into(), None, Some(0)).unwrap();
        uc.create("G2".into(), None, Some(1)).unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn update_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = PromptGroupsUseCase::new(&pool);
        match uc.update("ghost".into(), None, None, None).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "prompt_group"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = PromptGroupsUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "prompt_group"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn member_add_list_remove() {
        let pool = fresh_pool();
        seed_prompt(&pool, "p1");
        seed_prompt(&pool, "p2");
        let uc = PromptGroupsUseCase::new(&pool);
        let group = uc.create("G".into(), None, None).unwrap();

        uc.add_member(group.id.clone(), "p1".into(), 1).unwrap();
        uc.add_member(group.id.clone(), "p2".into(), 2).unwrap();

        let members = uc.list_members(&group.id).unwrap();
        assert_eq!(members, vec!["p1", "p2"]);

        uc.remove_member(group.id.clone(), "p1".into()).unwrap();
        let members = uc.list_members(&group.id).unwrap();
        assert_eq!(members, vec!["p2"]);
    }

    #[test]
    fn remove_member_not_found() {
        let pool = fresh_pool();
        let uc = PromptGroupsUseCase::new(&pool);
        let group = uc.create("G".into(), None, None).unwrap();
        match uc.remove_member(group.id, "ghost".into()).expect_err("nf") {
            AppError::NotFound { entity, .. } => {
                assert_eq!(entity, "prompt_group_member");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn set_members_replaces_all() {
        let pool = fresh_pool();
        seed_prompt(&pool, "p1");
        seed_prompt(&pool, "p2");
        seed_prompt(&pool, "p3");
        let uc = PromptGroupsUseCase::new(&pool);
        let group = uc.create("G".into(), None, None).unwrap();

        uc.add_member(group.id.clone(), "p1".into(), 1).unwrap();
        uc.set_members(group.id.clone(), vec!["p3".into(), "p2".into()])
            .unwrap();

        let members = uc.list_members(&group.id).unwrap();
        assert_eq!(members, vec!["p3", "p2"]);
    }
}
