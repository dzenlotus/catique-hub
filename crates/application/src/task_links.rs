//! Task-link use case — the minimal task↔task relationship model
//! (catique-4).
//!
//! ## Surface
//!
//! `TaskLinksUseCase` exposes three methods:
//!
//!   * [`TaskLinksUseCase::link`] — create one link (idempotent).
//!   * [`TaskLinksUseCase::unlink`] — remove one link (idempotent).
//!   * [`TaskLinksUseCase::list_for_task`] — every link a task
//!     participates in, either direction.
//!
//! ## Why the kind is an enum, not a free string
//!
//! The product ask was "the model should be very simple". A fixed
//! three-kind vocabulary ([`TaskLinkKind`]) is the simplest thing that
//! still lets the UI render direction. Decoding the wire value into the
//! enum at the application boundary means an unknown `kind` is rejected
//! with a typed [`AppError::Validation`] *before* it can reach the SQL
//! `CHECK` constraint — the user gets a clean field-scoped error rather
//! than an opaque constraint-violation.
//!
//! ## Existence pre-checks
//!
//! `link` pre-checks both task ids so a missing endpoint surfaces as a
//! typed [`AppError::NotFound`] instead of collapsing the FK violation
//! into a generic DB error. `unlink` is idempotent and does not
//! pre-check — removing a link that is already gone is a no-op success,
//! which is the friendlier contract for a UI "remove" button that may
//! race a realtime delete event.

use catique_domain::{TaskLink, TaskLinkKind};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::task_links::{self as repo, TaskLinkRow},
};

use crate::{error::AppError, error_map::map_db_err};

/// Use case wrapper. Cheap clone (pool is Arc-backed).
pub struct TaskLinksUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> TaskLinksUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// Create one link. Idempotent — re-issuing the same triple returns
    /// the link without error.
    ///
    /// # Errors
    ///
    /// * [`AppError::Validation`] (`field = "dstTaskId"`) when
    ///   `src == dst` (no self-links).
    /// * [`AppError::NotFound`] (`entity = "task"`) when either endpoint
    ///   is unknown.
    pub fn link(
        &self,
        src_task_id: &str,
        dst_task_id: &str,
        kind: TaskLinkKind,
    ) -> Result<TaskLink, AppError> {
        if src_task_id == dst_task_id {
            return Err(AppError::Validation {
                field: "dstTaskId".into(),
                reason: "a task cannot link to itself".into(),
            });
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // Pre-check both endpoints so a missing task surfaces a typed
        // NotFound rather than a raw FK violation.
        ensure_task_exists(&conn, src_task_id)?;
        ensure_task_exists(&conn, dst_task_id)?;

        let kind_sql = kind_to_sql(kind);
        repo::insert(&conn, src_task_id, dst_task_id, kind_sql).map_err(map_db_err)?;
        // Read the canonical row back so the returned `created_at`
        // reflects the stored value (matters when the link already
        // existed — we surface the original timestamp, not "now").
        let row = repo::list_for_task(&conn, src_task_id)
            .map_err(map_db_err)?
            .into_iter()
            .find(|r| {
                r.src_task_id == src_task_id && r.dst_task_id == dst_task_id && r.kind == kind_sql
            })
            .ok_or_else(|| AppError::NotFound {
                entity: "task_link".into(),
                id: format!("{src_task_id}->{dst_task_id}:{kind_sql}"),
            })?;
        hydrate(row)
    }

    /// Remove one link. Idempotent: removing a link that is already gone
    /// returns `Ok(false)` rather than an error, so the UI "remove"
    /// button is safe to double-fire.
    ///
    /// Returns `true` when a row was actually deleted.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn unlink(
        &self,
        src_task_id: &str,
        dst_task_id: &str,
        kind: TaskLinkKind,
    ) -> Result<bool, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::delete(&conn, src_task_id, dst_task_id, kind_to_sql(kind)).map_err(map_db_err)
    }

    /// List every link `task_id` participates in, either direction.
    /// Ordering is stable (kind ASC, created_at ASC) so the UI avoids
    /// flicker across realtime refreshes.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_for_task(&self, task_id: &str) -> Result<Vec<TaskLink>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_for_task(&conn, task_id).map_err(map_db_err)?;
        rows.into_iter().map(hydrate).collect()
    }
}

// ---------------------------------------------------------------------
// Helpers — module-private so the use case is the only writer to the
// contract.
// ---------------------------------------------------------------------

/// Map the typed [`TaskLinkKind`] to the SQL CHECK-constraint literal.
fn kind_to_sql(kind: TaskLinkKind) -> &'static str {
    match kind {
        TaskLinkKind::Related => "related",
        TaskLinkKind::Blocks => "blocks",
        TaskLinkKind::Parent => "parent",
    }
}

/// Inverse of [`kind_to_sql`]. Returns a typed error rather than a
/// silent fallback so a tampered row surfaces loudly instead of being
/// re-labelled as `related`.
fn kind_from_sql(s: &str) -> Result<TaskLinkKind, AppError> {
    match s {
        "related" => Ok(TaskLinkKind::Related),
        "blocks" => Ok(TaskLinkKind::Blocks),
        "parent" => Ok(TaskLinkKind::Parent),
        other => Err(AppError::Validation {
            field: "kind".into(),
            reason: format!("unknown task-link kind `{other}`"),
        }),
    }
}

/// Hydrate a storage row into the domain type.
fn hydrate(row: TaskLinkRow) -> Result<TaskLink, AppError> {
    Ok(TaskLink {
        kind: kind_from_sql(&row.kind)?,
        src_task_id: row.src_task_id,
        dst_task_id: row.dst_task_id,
        created_at: row.created_at,
    })
}

/// Cheap existence check returning a typed `NotFound` when missing.
fn ensure_task_exists(conn: &rusqlite::Connection, task_id: &str) -> Result<(), AppError> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM tasks WHERE id = ?1",
            rusqlite::params![task_id],
            |_| Ok(()),
        )
        .map(|()| true)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(other),
        })
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "task".into(),
            id: task_id.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    /// Seed a pool with three tasks (`ta`, `tb`, `tc`) hung off the
    /// minimal space → board → column scaffolding the FK chain needs.
    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, position, created_at, updated_at) \
             VALUES ('sp1','S','sp',0,0,0); \
             INSERT INTO boards (id, space_id, name, position, created_at, updated_at) \
             VALUES ('bd1','sp1','B',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
             VALUES ('co1','bd1','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, description, position, created_at, updated_at) \
             VALUES ('ta','bd1','co1','sp-1','A','',1.0,0,0), \
                    ('tb','bd1','co1','sp-2','B','',2.0,0,0), \
                    ('tc','bd1','co1','sp-3','C','',3.0,0,0);",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn link_then_list_round_trips() {
        let pool = fresh_pool();
        let uc = TaskLinksUseCase::new(&pool);
        let link = uc.link("ta", "tb", TaskLinkKind::Blocks).unwrap();
        assert_eq!(link.src_task_id, "ta");
        assert_eq!(link.dst_task_id, "tb");
        assert_eq!(link.kind, TaskLinkKind::Blocks);

        let links = uc.list_for_task("tb").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].kind, TaskLinkKind::Blocks);
    }

    #[test]
    fn link_is_idempotent() {
        let pool = fresh_pool();
        let uc = TaskLinksUseCase::new(&pool);
        let a = uc.link("ta", "tb", TaskLinkKind::Related).unwrap();
        let b = uc.link("ta", "tb", TaskLinkKind::Related).unwrap();
        // Same stored timestamp on the second call — proves we read the
        // canonical row back rather than minting a fresh "now".
        assert_eq!(a.created_at, b.created_at);
        assert_eq!(uc.list_for_task("ta").unwrap().len(), 1);
    }

    #[test]
    fn self_link_rejected_with_validation() {
        let pool = fresh_pool();
        let uc = TaskLinksUseCase::new(&pool);
        match uc.link("ta", "ta", TaskLinkKind::Related).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "dstTaskId"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn link_unknown_task_returns_not_found() {
        let pool = fresh_pool();
        let uc = TaskLinksUseCase::new(&pool);
        match uc
            .link("ta", "ghost", TaskLinkKind::Related)
            .expect_err("nf")
        {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "task");
                assert_eq!(id, "ghost");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn unlink_is_idempotent() {
        let pool = fresh_pool();
        let uc = TaskLinksUseCase::new(&pool);
        uc.link("ta", "tb", TaskLinkKind::Parent).unwrap();
        assert!(uc.unlink("ta", "tb", TaskLinkKind::Parent).unwrap());
        assert!(!uc.unlink("ta", "tb", TaskLinkKind::Parent).unwrap());
        assert!(uc.list_for_task("ta").unwrap().is_empty());
    }

    #[test]
    fn list_returns_both_directions() {
        let pool = fresh_pool();
        let uc = TaskLinksUseCase::new(&pool);
        uc.link("ta", "tb", TaskLinkKind::Related).unwrap();
        uc.link("tc", "ta", TaskLinkKind::Blocks).unwrap();
        let links = uc.list_for_task("ta").unwrap();
        assert_eq!(links.len(), 2);
        assert!(links
            .iter()
            .any(|l| l.kind == TaskLinkKind::Blocks && l.src_task_id == "tc"));
        assert!(links
            .iter()
            .any(|l| l.kind == TaskLinkKind::Related && l.dst_task_id == "tb"));
    }
}
