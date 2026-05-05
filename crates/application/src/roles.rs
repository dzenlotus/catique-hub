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
}

fn row_to_role(row: RoleRow) -> Role {
    Role {
        id: row.id,
        name: row.name,
        content: row.content,
        color: row.color,
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
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        let role = uc.create("Owner".into(), String::new(), None).unwrap();

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
        let role = uc.create("Solo".into(), String::new(), None).unwrap();
        uc.delete(&role.id).expect("delete unguarded user role");
        match uc.get(&role.id).expect_err("gone") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "role"),
            other => panic!("got {other:?}"),
        }
    }
}
