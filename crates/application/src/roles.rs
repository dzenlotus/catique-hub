//! Roles use case.
//!
//! Wave-E2.4 (Olga). Mirrors the other use cases. UNIQUE(name) is
//! mapped to `AppError::Conflict { entity: "role", … }`.

use catique_domain::{Prompt, Role};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::content_versions::{self as versions, ContentVersionRow},
    repositories::prompts::PromptRow,
    repositories::roles::{self as repo, RoleDraft, RolePatch, RoleRow},
    repositories::tasks::{
        cascade_clear_scope, cascade_prompt_attachment, recompute_effective_counts_for_scope,
        AttachScope,
    },
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// D-C: how many content versions to keep per role.
const ROLE_VERSION_RETENTION: usize = 50;
/// D-C: 5-minute debounce window (in milliseconds) between snapshots
/// of `role.content`. Editing the same role within this window only
/// produces a single row — the first edit captures the start-of-
/// session content, subsequent edits update `roles.content` without
/// adding history rows.
const ROLE_VERSION_DEBOUNCE_MS: i64 = 5 * 60 * 1_000;

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
    /// **D-C version history**: when `content` is `Some(_)` AND it
    /// actually changes the stored value, a debounced snapshot of the
    /// *previous* content lands in `role_content_versions` (one row
    /// per 5-min editing window, last 50 rows retained per role).
    /// Every other field (name, color, icon) is touched without
    /// touching the version stream — those are not history-tracked.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id missing.
    #[allow(clippy::needless_pass_by_value)]
    // `Option<Option<String>>` is the project-wide tri-state encoding
    // for nullable column patches (`None` = leave alone, `Some(None)` =
    // clear, `Some(Some(s))` = set). Lifting it into a dedicated enum
    // would be churn for no real readability win; we silence the lint
    // and document the convention in module-level comments.
    #[allow(clippy::option_option)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        content: Option<String>,
        color: Option<Option<String>>,
        icon: Option<Option<String>>,
    ) -> Result<Role, AppError> {
        self.update_with_clock(id, name, content, color, icon, default_clock)
    }

    /// Clock-injected variant of [`Self::update`]. Production calls
    /// [`Self::update`] which seeds the wall clock; tests can pass a
    /// fixed clock to verify debounce semantics without sleeping.
    ///
    /// # Errors
    ///
    /// See [`Self::update`].
    #[allow(clippy::needless_pass_by_value)]
    #[allow(clippy::option_option)]
    pub(crate) fn update_with_clock<F>(
        &self,
        id: String,
        name: Option<String>,
        content: Option<String>,
        color: Option<Option<String>>,
        icon: Option<Option<String>>,
        clock: F,
    ) -> Result<Role, AppError>
    where
        F: Fn() -> i64,
    {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }

        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;

        // Snapshot BEFORE the write, only when the caller is actually
        // changing content AND the new value differs from the stored
        // value. Identical-write debouncing keeps storage clean for the
        // common "save same text" autosave path.
        if let Some(new_content) = content.as_deref() {
            let previous = repo::get_by_id(&tx, &id).map_err(map_db_err)?;
            if let Some(prev) = previous {
                if prev.content != new_content {
                    snapshot_role_if_due(&tx, &id, &prev.content, clock())?;
                }
            }
        }

        let patch = RolePatch {
            name: name.map(|n| n.trim().to_owned()),
            content,
            color,
            icon,
        };
        let updated = repo::update(&tx, &id, &patch).map_err(|e| map_db_err_unique(e, "role"))?;
        let Some(role) = updated else {
            return Err(AppError::NotFound {
                entity: "role".into(),
                id,
            });
        };
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(row_to_role(role))
    }

    /// List the last 50 content-version rows for a role, newest first.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_role_versions(&self, role_id: &str) -> Result<Vec<RoleContentVersion>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = versions::list_role_versions(&conn, role_id, ROLE_VERSION_RETENTION)
            .map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_version).collect())
    }

    /// Fetch the full content of one version row by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the version id is unknown.
    pub fn get_role_version(&self, version_id: &str) -> Result<RoleContentVersion, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = versions::get_role_version(&conn, version_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "role_content_version".into(),
                id: version_id.to_owned(),
            })?;
        Ok(row_to_version(row))
    }

    /// Revert a role's content to the value stored in `version_id`.
    ///
    /// The pre-revert content is itself snapshotted into a new version
    /// row (subject to the 5-min debounce, like any other write). The
    /// target version row is **not** removed — the user can re-revert
    /// in either direction.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if `version_id` is unknown, or if the
    /// underlying role row vanished between the lookup and the update.
    pub fn revert_role_to_version(&self, version_id: &str) -> Result<Role, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let version = versions::get_role_version(&conn, version_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "role_content_version".into(),
                id: version_id.to_owned(),
            })?;
        drop(conn);
        // Delegate to `update` so the pre-revert content snapshot +
        // debounce + transaction handling stays in one place. The
        // revert acts as a normal content write from the use-case's
        // point of view.
        self.update(
            version.source_id.clone(),
            None,
            Some(version.content),
            None,
            None,
        )
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
        // Refactor-v3 D-B: the cascade just rewrote `task_prompts` rows
        // for every task on this role. Recompute the denormalised
        // counters in the same transaction so the post-commit state is
        // self-consistent.
        recompute_effective_counts_for_scope(&tx, &scope).map_err(map_db_err)?;

        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Prompts directly attached to a role, ordered by position. Read
    /// counterpart to [`Self::set_role_prompts`]; used by the role
    /// editor's "Prompts" attachment section.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_role_prompts(&self, role_id: &str) -> Result<Vec<Prompt>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_role_prompts(&conn, role_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(prompt_row_to_prompt).collect())
    }
}

fn prompt_row_to_prompt(row: PromptRow) -> Prompt {
    Prompt {
        id: row.id,
        name: row.name,
        content: row.content,
        color: row.color,
        short_description: row.short_description,
        icon: row.icon,
        examples: row.examples,
        token_count: row.token_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
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

/// D-C: snapshot the PRE-update content of `role_id` if the most-recent
/// version row is at least [`ROLE_VERSION_DEBOUNCE_MS`] old (or no
/// version row exists yet), then prune everything beyond
/// [`ROLE_VERSION_RETENTION`].
///
/// `now_ms` is passed in so the same call site can run under a fake
/// clock in tests. The helper runs against `conn` — caller decides
/// whether that's a stand-alone `Connection` or a `Transaction`; both
/// `Deref` to `Connection` so the rusqlite functions work uniformly.
fn snapshot_role_if_due(
    conn: &rusqlite::Connection,
    role_id: &str,
    pre_update_content: &str,
    now_ms: i64,
) -> Result<(), AppError> {
    let due = match versions::latest_role_version_timestamp(conn, role_id).map_err(map_db_err)? {
        Some(latest) => now_ms.saturating_sub(latest) >= ROLE_VERSION_DEBOUNCE_MS,
        None => true,
    };
    if due {
        versions::insert_role_version_at(conn, role_id, pre_update_content, None, now_ms)
            .map_err(map_db_err)?;
        versions::prune_role_versions(conn, role_id, ROLE_VERSION_RETENTION).map_err(map_db_err)?;
    }
    Ok(())
}

/// D-C: one content-version row as returned to the IPC layer. Wire
/// shape lives in `crates/api/src/handlers/roles.rs` (ts-rs export);
/// the application layer keeps a plain struct so this crate has no
/// `serde`/`ts-rs` dependency in its hot path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleContentVersion {
    pub id: String,
    pub role_id: String,
    pub content: String,
    pub created_at: i64,
    pub author_note: Option<String>,
}

fn row_to_version(row: ContentVersionRow) -> RoleContentVersion {
    RoleContentVersion {
        id: row.id,
        role_id: row.source_id,
        content: row.content,
        created_at: row.created_at,
        author_note: row.author_note,
    }
}

/// Wall-clock seed for [`RolesUseCase::update`]. Lifted into a free
/// function so the clock-injected variant in tests can pass any
/// `Fn() -> i64`. Saturating on pre-1970 / year-292M overflow follows
/// the same convention as `infrastructure::repositories::util::now_millis`.
fn default_clock() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
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
    fn list_role_prompts_returns_attached_in_position_order() {
        let (pool, role_id) = seed_role_prompts_fixture();
        let uc = RolesUseCase::new(&pool);

        // Attach in the order [p2, p1] — positions 1, 2.
        uc.set_role_prompts(role_id.clone(), vec!["p2".into(), "p1".into()])
            .unwrap();

        let listed = uc.list_role_prompts(&role_id).unwrap();
        let ids: Vec<String> = listed.into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["p2".to_string(), "p1".to_string()]);

        // Empty after clearing.
        uc.set_role_prompts(role_id.clone(), Vec::new()).unwrap();
        assert!(uc.list_role_prompts(&role_id).unwrap().is_empty());
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

    // -----------------------------------------------------------------
    // D-C — content-version history: debounce, retention, revert.
    // -----------------------------------------------------------------

    /// Helper for the test suite: clock cell that returns the same
    /// value on every call; tests bump it between phases to simulate
    /// the passage of real time without sleeping.
    fn fixed_clock(value: i64) -> impl Fn() -> i64 {
        move || value
    }

    /// Direct row count against `role_content_versions` — used by the
    /// debounce tests because the use-case caps `list_role_versions`
    /// at 50 by design and never surfaces "how many rows exist".
    fn count_role_versions(pool: &Pool, role_id: &str) -> i64 {
        let conn = acquire(pool).unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM role_content_versions WHERE role_id = ?1",
            rusqlite::params![role_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn t1_role_update_within_debounce_window_writes_single_version() {
        // Two content-changing updates inside the 5-minute window:
        // the first snapshots the pre-update content, the second
        // sees a recent version row and skips.
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        let role = uc
            .create("Debouncer".into(), "v0".into(), None, None)
            .unwrap();
        uc.update_with_clock(
            role.id.clone(),
            None,
            Some("v1".into()),
            None,
            None,
            fixed_clock(10_000),
        )
        .unwrap();
        uc.update_with_clock(
            role.id.clone(),
            None,
            Some("v2".into()),
            None,
            None,
            fixed_clock(10_500),
        )
        .unwrap();
        assert_eq!(count_role_versions(&pool, &role.id), 1);
        // The single row captures the FIRST pre-update content (v0).
        let listed = uc.list_role_versions(&role.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].content, "v0");
    }

    #[test]
    fn t2_role_update_beyond_debounce_window_writes_new_version() {
        // First content edit snapshots v0; second edit happens 6 min
        // later (well past the 5-min debounce) so a second row lands
        // capturing the pre-update content of that write.
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        let role = uc
            .create("Sessioned".into(), "v0".into(), None, None)
            .unwrap();
        uc.update_with_clock(
            role.id.clone(),
            None,
            Some("v1".into()),
            None,
            None,
            fixed_clock(10_000),
        )
        .unwrap();
        // +6 minutes — past the 5-minute debounce.
        let later = 10_000 + 6 * 60 * 1_000;
        uc.update_with_clock(
            role.id.clone(),
            None,
            Some("v2".into()),
            None,
            None,
            fixed_clock(later),
        )
        .unwrap();
        assert_eq!(count_role_versions(&pool, &role.id), 2);
        let listed = uc.list_role_versions(&role.id).unwrap();
        // Newest-first ordering: pre-update of the second edit was v1.
        assert_eq!(listed[0].content, "v1");
        assert_eq!(listed[1].content, "v0");
    }

    #[test]
    fn t3_role_version_retention_caps_at_fifty() {
        // 51 separate editing sessions (each its own clock window) must
        // produce exactly 50 surviving version rows; the oldest one is
        // pruned away after the 51st snapshot lands.
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        let role = uc
            .create("Prolific".into(), "v0".into(), None, None)
            .unwrap();
        // Each iteration uses a clock advance of 10 minutes so the
        // debounce window never suppresses a snapshot.
        let step = 10 * 60 * 1_000_i64;
        for i in 1..=51_i64 {
            uc.update_with_clock(
                role.id.clone(),
                None,
                Some(format!("v{i}")),
                None,
                None,
                fixed_clock(step.saturating_mul(i)),
            )
            .unwrap();
        }
        assert_eq!(count_role_versions(&pool, &role.id), 50);
        let listed = uc.list_role_versions(&role.id).unwrap();
        assert_eq!(listed.len(), 50);
        // Newest row carries the pre-update content of the 51st write,
        // which was "v50".
        assert_eq!(listed[0].content, "v50");
        // Oldest surviving row is the pre-update of the 2nd write =
        // "v1" — the v0 snapshot got pruned out.
        assert_eq!(listed[49].content, "v1");
    }

    #[test]
    fn t4_revert_role_to_version_sets_content_and_snapshots_pre_revert() {
        // Set up: v0 → v1 (snapshots v0). After 6 min: revert to the
        // v0 version row. The revert must (a) put the role back on
        // "v0" content, and (b) leave a new version row carrying the
        // pre-revert content "v1" — so the user can re-revert.
        let pool = fresh_pool();
        let uc = RolesUseCase::new(&pool);
        let role = uc
            .create("Reverter".into(), "v0".into(), None, None)
            .unwrap();
        uc.update_with_clock(
            role.id.clone(),
            None,
            Some("v1".into()),
            None,
            None,
            fixed_clock(10_000),
        )
        .unwrap();
        let v0_row = uc
            .list_role_versions(&role.id)
            .unwrap()
            .into_iter()
            .find(|v| v.content == "v0")
            .expect("v0 snapshot");
        // Drive the revert through the real public entry point — the
        // wall clock will be used here, but since the previous
        // snapshot landed at t=10_000 ms (epoch start of the test
        // pool), 60 years of real time will easily satisfy the
        // debounce. So we get a deterministic new version row.
        let after = uc.revert_role_to_version(&v0_row.id).unwrap();
        assert_eq!(after.content, "v0");
        let listed = uc.list_role_versions(&role.id).unwrap();
        // Two rows: the original v0 snapshot + the v1 snapshot the
        // revert created. The target version row stays in place.
        assert_eq!(listed.len(), 2, "got: {listed:?}");
        let contents: Vec<&str> = listed.iter().map(|v| v.content.as_str()).collect();
        assert!(contents.contains(&"v0"), "original snapshot survives");
        assert!(contents.contains(&"v1"), "pre-revert content snapshotted");
    }
}
