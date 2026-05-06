//! Roles use case.
//!
//! Wave-E2.4 (Olga). Mirrors the other use cases. UNIQUE(name) is
//! mapped to `AppError::Conflict { entity: "role", … }`.

use catique_domain::Role;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::roles::{self as repo, RoleDraft, RolePatch, RoleRow},
    repositories::tasks::{cascade_clear_scope, cascade_prompt_attachment, AttachScope},
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
        icon: Option<String>,
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
                icon,
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
        icon: Option<Option<String>>,
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
            icon,
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
    /// Cat-as-Agent Phase 1 (ctq-87, audit F-04) guards two states the
    /// raw repository call would silently honour:
    ///
    /// 1. `is_system = 1` rows seeded by migration
    ///    `004_cat_as_agent_phase1.sql` (`maintainer-system`,
    ///    `dirizher-system`) are immutable provenance — losing
    ///    Maintainer in particular would orphan every default-owned
    ///    board's owner FK.
    /// 2. A user-created role still owning at least one board would
    ///    cascade into broken board ownership; the FK on
    ///    `boards.owner_role_id` (NOT NULL, no ON DELETE) would
    ///    otherwise fail at SQL level with a constraint violation that
    ///    the error mapper flattens into `TransactionRolledBack` —
    ///    useless for the UI.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` if id is unknown.
    /// * `AppError::Forbidden` if the role is a system row.
    /// * `AppError::Conflict` if the role still owns at least one board.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;

        // Pre-check 1: load the row and refuse if it is a system row.
        // We read the row first so we can also surface `NotFound` with
        // the correct entity name when the id is unknown — checking
        // `is_system` after a successful DELETE would be too late.
        let Some(role) = repo::get_by_id(&conn, id).map_err(map_db_err)? else {
            return Err(AppError::NotFound {
                entity: "role".into(),
                id: id.to_owned(),
            });
        };
        if role.is_system {
            return Err(AppError::Forbidden {
                reason: "system role cannot be deleted".into(),
            });
        }

        // Pre-check 2: refuse if any board still references this role
        // as its owner. We surface the count in the message so the UI
        // can render a "reassign N boards first" affordance without a
        // second roundtrip.
        let board_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM boards WHERE owner_role_id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if board_count > 0 {
            return Err(AppError::Conflict {
                entity: "role".into(),
                reason: format!("role owns {board_count} boards; reassign first"),
            });
        }

        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            // Race window: the row vanished between our get_by_id
            // pre-check and the DELETE. Treat as NotFound for parity
            // with the boards use-case.
            Err(AppError::NotFound {
                entity: "role".into(),
                id: id.to_owned(),
            })
        }
    }

    /// Atomically replace the full ordered prompt list for a role.
    /// Mirrors `SpacesUseCase::set_space_prompts` (ctq-99) and
    /// `prompt_groups::set_members` — single immediate transaction,
    /// FK violation rolls everything back.
    ///
    /// ADR-0006 / ctq-108: clears every `task_prompts` row tagged with
    /// this role's origin (`role:<id>`), DELETEs the join-table rows,
    /// re-INSERTs the new ordered list, and re-cascades each prompt so
    /// every task whose `role_id = role_id` ends up with a freshly
    /// materialised inherited row. Direct attachments survive (the
    /// resolver's override rule keeps them on top).
    ///
    /// `prompt_ids` may be empty: that clears the role's prompt
    /// attachments in one round-trip.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation (unknown
    /// `role_id` or any prompt id).
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_role_prompts(
        &self,
        role_id: String,
        prompt_ids: Vec<String>,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;

        // Clear the old set and the inherited materialisations in one
        // shot. Order matters: cascade_clear_scope reads `origin` only,
        // so it doesn't depend on the join table; running it first vs.
        // last is observationally equivalent inside the same tx, but
        // we issue the join-table DELETE first so the schema's CASCADE
        // FK can't surprise us.
        tx.execute(
            "DELETE FROM role_prompts WHERE role_id = ?1",
            rusqlite::params![role_id],
        )
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        let scope = AttachScope::Role(role_id.clone());
        cascade_clear_scope(&tx, &scope).map_err(map_db_err)?;

        for (idx, prompt_id) in prompt_ids.iter().enumerate() {
            #[allow(clippy::cast_precision_loss)]
            let position = (idx + 1) as f64;
            tx.execute(
                "INSERT INTO role_prompts (role_id, prompt_id, position) \
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![role_id, prompt_id, position],
            )
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
            cascade_prompt_attachment(&tx, &scope, prompt_id, position).map_err(map_db_err)?;
        }

        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }
}

fn row_to_role(row: RoleRow) -> Role {
    Role {
        id: row.id,
        name: row.name,
        content: row.content,
        color: row.color,
        icon: row.icon,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_system: row.is_system,
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
            .create("R".into(), String::new(), Some("not-a-color".into()), None)
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
        uc.create("Same".into(), String::new(), None, None).unwrap();
        match uc
            .create("Same".into(), String::new(), None, None)
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
        uc.create("R".into(), String::new(), Some("#abcdef".into()), None)
            .unwrap();
        let list = uc.list().unwrap();
        // Migration `004_cat_as_agent_phase1.sql` seeds `Maintainer`
        // + `Dirizher` system rows. The user-created `R` row is the
        // only non-system entry; assert on that subset rather than
        // the global count so future system rows don't bend the test.
        let user_rows: Vec<_> = list.iter().filter(|r| !r.is_system).collect();
        assert_eq!(user_rows.len(), 1);
        assert_eq!(user_rows[0].name, "R");
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

    // -----------------------------------------------------------------
    // ctq-87 — delete_role guards against system rows + owned boards.
    // -----------------------------------------------------------------

    #[test]
    fn delete_role_rejects_system() {
        // Migration 004 seeds `maintainer-system` as a system row with
        // is_system = 1. The use-case must refuse the delete with
        // Forbidden before touching the repository.
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        match uc.delete("maintainer-system").expect_err("forbidden") {
            AppError::Forbidden { reason } => {
                assert!(
                    reason.contains("system role"),
                    "unexpected reason: {reason}"
                );
            }
            other => panic!("expected Forbidden, got {other:?}"),
        }
        // Belt-and-braces: row must still exist.
        assert!(uc.get("maintainer-system").is_ok());
    }

    #[test]
    fn delete_role_rejects_when_boards_reference_it() {
        // Set up a user role that owns one board, then try to delete it.
        // The fixture name avoids "Owner" — that's the post-017 display
        // name of the seeded `maintainer-system` row, and `roles.name`
        // carries a UNIQUE constraint.
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        let role = uc
            .create("BoardOwner".into(), String::new(), None, None)
            .unwrap();

        // Seed a space + a board owned by the new role directly via
        // SQL — going through the boards use-case would hide the
        // `owner_role_id` field we're testing against.
        {
            let conn = acquire(&pool).unwrap();
            conn.execute(
                "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO boards (id, name, space_id, position, created_at, updated_at, owner_role_id) \
                 VALUES ('bd1','B','sp1',0,0,0,?1)",
                rusqlite::params![role.id],
            )
            .unwrap();
        }

        match uc.delete(&role.id).expect_err("conflict") {
            AppError::Conflict { entity, reason } => {
                assert_eq!(entity, "role");
                assert!(
                    reason.contains("owns 1 boards"),
                    "unexpected reason: {reason}"
                );
            }
            other => panic!("expected Conflict, got {other:?}"),
        }
        // The role must still be there.
        assert!(uc.get(&role.id).is_ok());
    }

    #[test]
    fn delete_role_succeeds_when_no_references() {
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        let role = uc.create("Solo".into(), String::new(), None, None).unwrap();
        uc.delete(&role.id).expect("delete unguarded user role");
        match uc.get(&role.id).expect_err("gone") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "role"),
            other => panic!("got {other:?}"),
        }
    }

    // -----------------------------------------------------------------
    // ctq-108 — set_role_prompts bulk setter.
    // -----------------------------------------------------------------

    /// Seed a fresh DB with three prompts (`p1`, `p2`, `p3`) and one
    /// role attached to a single task. Returns the role id so the
    /// individual tests don't have to keep restating the boilerplate.
    fn seed_role_prompts_fixture() -> (Pool, String) {
        let pool = fresh_pool();
        let role = RolesUseCase::new(&pool)
            .create("Reviewer".into(), String::new(), None, None)
            .unwrap();
        {
            let conn = acquire(&pool).unwrap();
            conn.execute_batch(
                "INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p1','P1','',0,0), \
                     ('p2','P2','',0,0), \
                     ('p3','P3','',0,0); \
                 INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                     VALUES ('sp1','Space','sp',0,0,0,0); \
                 INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                     VALUES ('bd1','B','sp1',0,0,0); \
                 INSERT INTO columns (id, board_id, name, position, created_at) \
                     VALUES ('c1','bd1','C',0,0);",
            )
            .unwrap();
            // Seed one task on the role so cascade_prompt_attachment
            // has a target row to materialise into.
            conn.execute(
                "INSERT INTO tasks (id, board_id, column_id, slug, title, position, role_id, created_at, updated_at) \
                 VALUES ('t1','bd1','c1','sp-1','T',0,?1,0,0)",
                rusqlite::params![role.id],
            )
            .unwrap();
        }
        (pool, role.id)
    }

    #[test]
    fn set_role_prompts_replaces_ordering_and_cascades() {
        let (pool, role_id) = seed_role_prompts_fixture();
        let uc = RolesUseCase::new(&pool);

        // Initial set: [p1, p2].
        uc.set_role_prompts(role_id.clone(), vec!["p1".into(), "p2".into()])
            .unwrap();
        {
            let conn = acquire(&pool).unwrap();
            let join_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM role_prompts WHERE role_id = ?1",
                    rusqlite::params![role_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(join_count, 2);
            // Materialised rows on `t1` for the two prompts.
            let mat_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM task_prompts WHERE task_id = 't1' AND origin = ?1",
                    rusqlite::params![format!("role:{role_id}")],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(mat_count, 2);
        }

        // Replace with [p3, p1] — p2 must be wiped, p3 added.
        uc.set_role_prompts(role_id.clone(), vec!["p3".into(), "p1".into()])
            .unwrap();
        {
            let conn = acquire(&pool).unwrap();
            // role_prompts contains exactly p3 then p1 (positions 1, 2).
            let mut stmt = conn
                .prepare(
                    "SELECT prompt_id FROM role_prompts \
                     WHERE role_id = ?1 ORDER BY position ASC",
                )
                .unwrap();
            let rows: Vec<String> = stmt
                .query_map(rusqlite::params![role_id], |r| r.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            assert_eq!(rows, vec!["p3".to_string(), "p1".to_string()]);

            // Materialised rows: only the new set is present.
            let mat: Vec<String> = conn
                .prepare(
                    "SELECT prompt_id FROM task_prompts \
                     WHERE task_id = 't1' AND origin = ?1 ORDER BY prompt_id",
                )
                .unwrap()
                .query_map(rusqlite::params![format!("role:{role_id}")], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap()
                .map(Result::unwrap)
                .collect();
            assert_eq!(mat, vec!["p1".to_string(), "p3".to_string()]);
        }
    }

    #[test]
    fn set_role_prompts_with_empty_clears_all() {
        let (pool, role_id) = seed_role_prompts_fixture();
        let uc = RolesUseCase::new(&pool);
        uc.set_role_prompts(role_id.clone(), vec!["p1".into(), "p2".into()])
            .unwrap();
        uc.set_role_prompts(role_id.clone(), Vec::new()).unwrap();

        let conn = acquire(&pool).unwrap();
        let join_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM role_prompts WHERE role_id = ?1",
                rusqlite::params![role_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(join_count, 0);
        let mat_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_prompts WHERE origin = ?1",
                rusqlite::params![format!("role:{role_id}")],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mat_count, 0);
    }

    #[test]
    fn set_role_prompts_atomic_on_fk_error() {
        // FK violation on a non-existent prompt mid-list must roll the
        // entire transaction back — the join table stays at the
        // pre-call state.
        let (pool, role_id) = seed_role_prompts_fixture();
        let uc = RolesUseCase::new(&pool);

        // Pre-state: [p1].
        uc.set_role_prompts(role_id.clone(), vec!["p1".into()])
            .unwrap();

        // Fail mid-way: [p2, ghost, p3]. Whole tx must roll back.
        let err = uc
            .set_role_prompts(
                role_id.clone(),
                vec!["p2".into(), "ghost".into(), "p3".into()],
            )
            .expect_err("FK violation");
        match err {
            AppError::TransactionRolledBack { .. } => {}
            other => panic!("expected TransactionRolledBack, got {other:?}"),
        }

        // Pre-state must survive — exactly p1, no p2/p3 rows.
        let conn = acquire(&pool).unwrap();
        let join_ids: Vec<String> = conn
            .prepare(
                "SELECT prompt_id FROM role_prompts \
                 WHERE role_id = ?1 ORDER BY position ASC",
            )
            .unwrap()
            .query_map(rusqlite::params![role_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(join_ids, vec!["p1".to_string()]);
    }
}
