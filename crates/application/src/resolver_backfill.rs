//! Resolver backfill walker (ADR-0006, R-1 / OQ-1).
//!
//! Existing rows in `role_prompts`, `board_prompts`, `column_prompts`,
//! and `space_prompts` were attached *before* the write-time
//! materialisation strategy landed; the cleanup trigger
//! `cleanup_role_origin_on_role_delete` (`001_initial.sql:245-251`)
//! also assumes materialised rows exist for every cascading source.
//! Without a one-shot backfill on first boot post-ctq-98, the resolver
//! would return only `direct` rows on legacy DBs.
//!
//! ## Strategy (OQ-1 — committed)
//!
//! **Chunked transactions, idempotent INSERTs.** The walker enumerates
//! every join-table row and re-runs the cascade for it. A single
//! `INSERT … ON CONFLICT DO NOTHING` per row makes the operation
//! idempotent: re-running the walker on a partially-completed DB just
//! no-ops on the rows that already materialised.
//!
//! Why chunked rather than a single mega-transaction:
//!
//! * **Lock blast radius.** A single tx over thousands of attachments
//!   would hold the writer lock for the entire walk; concurrent reads
//!   in other connections would block on `busy_timeout` and either
//!   spuriously fail or stall the UI. Chunking caps the per-tx
//!   duration to a small batch the writer-window absorbs cleanly.
//!
//! * **Crash safety.** SQLite WAL atomicity is per-tx. A power-cut
//!   mid-mega-tx loses the entire pass; a power-cut mid-chunk loses
//!   only that chunk's progress. The walker is idempotent so the
//!   resume cost is bounded by chunk size, not whole-walk size.
//!
//! * **Memory.** Streaming the join-table cursor row-by-row keeps the
//!   walker's working set O(1); a single `INSERT … SELECT` would
//!   materialise the candidate task set in temp space.
//!
//! The completion flag is the single setting key
//! `resolver_backfill_done` = `"true"`. We do NOT use a per-scope
//! cursor — the idempotent INSERT pattern means re-running on a
//! partially-completed DB is cheap. The flag is the "we definitely
//! never need to do this again" hint, not a correctness invariant.
//!
//! ## Invocation
//!
//! Called once at startup from `src-tauri/src/lib.rs::init_state`
//! after the migration runner finishes. Returns the number of rows
//! materialised across all four scope tables.

use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        settings,
        tasks::{cascade_prompt_attachment, AttachScope},
    },
};
use rusqlite::params;

use crate::{error::AppError, error_map::map_db_err};

/// Settings key flipped to `"true"` once the walk completes.
pub const BACKFILL_FLAG_KEY: &str = "resolver_backfill_done";

/// Chunk size — number of attachments per backfill transaction. At
/// ~5 µs per cascade INSERT and a typical 100-task board, one chunk is
/// ~100 ms of writer-lock time — well inside the `busy_timeout` budget
/// so concurrent IPC handlers wait cleanly rather than fail.
const CHUNK: usize = 200;

/// One unit of work the walker streams from the cursor: which scope +
/// which `(prompt_id, position)` pair to cascade onto every task in
/// scope. The cascade itself is idempotent on `(task_id, prompt_id)`
/// thanks to the `ON CONFLICT DO NOTHING` clause inside
/// `cascade_prompt_attachment` (see `tasks.rs`).
struct BackfillItem {
    scope: AttachScope,
    prompt_id: String,
    position: f64,
}

/// Run the backfill walker if the `resolver_backfill_done` flag has not
/// yet been set. No-op on a DB where the flag is already `"true"`.
///
/// Returns the number of `task_prompts` rows the walker materialised
/// (zero when the walker exits early because the flag is set).
///
/// # Errors
///
/// Forwards storage-layer errors. The walker is restartable — see the
/// module-level docs for the chunking + idempotency contract.
pub fn run_if_pending(pool: &Pool) -> Result<usize, AppError> {
    {
        let conn = acquire(pool).map_err(map_db_err)?;
        if settings::get_setting(&conn, BACKFILL_FLAG_KEY)
            .map_err(map_db_err)?
            .as_deref()
            == Some("true")
        {
            return Ok(0);
        }
    }

    let items = collect_items(pool)?;
    let mut inserted = 0_usize;
    for batch in items.chunks(CHUNK) {
        let mut conn = acquire(pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        for item in batch {
            inserted += cascade_prompt_attachment(&tx, &item.scope, &item.prompt_id, item.position)
                .map_err(map_db_err)?;
        }
        tx.commit().map_err(|e| map_db_err(e.into()))?;
    }

    let conn = acquire(pool).map_err(map_db_err)?;
    settings::set_setting(&conn, BACKFILL_FLAG_KEY, "true").map_err(map_db_err)?;
    Ok(inserted)
}

/// Stream every `(scope, prompt_id, position)` triple from the four
/// scope-prompt join tables. The walker collects into memory because
/// the desktop scale is small (low thousands of rows total) and the
/// chunked-tx loop above iterates the result.
fn collect_items(pool: &Pool) -> Result<Vec<BackfillItem>, AppError> {
    let conn = acquire(pool).map_err(map_db_err)?;
    let mut out = Vec::new();

    // role_prompts
    let mut stmt = conn
        .prepare("SELECT role_id, prompt_id, position FROM role_prompts")
        .map_err(|e| map_db_err(e.into()))?;
    let rows = stmt
        .query_map(params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })
        .map_err(|e| map_db_err(e.into()))?;
    for row in rows {
        let (role_id, prompt_id, position) = row.map_err(|e| map_db_err(e.into()))?;
        out.push(BackfillItem {
            scope: AttachScope::Role(role_id),
            prompt_id,
            position,
        });
    }
    drop(stmt);

    // board_prompts (position is INTEGER on this table)
    let mut stmt = conn
        .prepare("SELECT board_id, prompt_id, position FROM board_prompts")
        .map_err(|e| map_db_err(e.into()))?;
    let rows = stmt
        .query_map(params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| map_db_err(e.into()))?;
    for row in rows {
        let (board_id, prompt_id, position) = row.map_err(|e| map_db_err(e.into()))?;
        #[allow(clippy::cast_precision_loss)]
        let pos_f = position as f64;
        out.push(BackfillItem {
            scope: AttachScope::Board(board_id),
            prompt_id,
            position: pos_f,
        });
    }
    drop(stmt);

    // column_prompts (position is INTEGER)
    let mut stmt = conn
        .prepare("SELECT column_id, prompt_id, position FROM column_prompts")
        .map_err(|e| map_db_err(e.into()))?;
    let rows = stmt
        .query_map(params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| map_db_err(e.into()))?;
    for row in rows {
        let (column_id, prompt_id, position) = row.map_err(|e| map_db_err(e.into()))?;
        #[allow(clippy::cast_precision_loss)]
        let pos_f = position as f64;
        out.push(BackfillItem {
            scope: AttachScope::Column(column_id),
            prompt_id,
            position: pos_f,
        });
    }
    drop(stmt);

    // space_prompts — only present after migration `011_space_prompts.sql`.
    // We probe the schema first so older DBs (where the table is
    // genuinely missing because migration ledger drift) skip cleanly
    // rather than fail the whole walker.
    let table_present: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master \
             WHERE type = 'table' AND name = 'space_prompts'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| map_db_err(e.into()))?;
    if table_present > 0 {
        let mut stmt = conn
            .prepare("SELECT space_id, prompt_id, position FROM space_prompts")
            .map_err(|e| map_db_err(e.into()))?;
        let rows = stmt
            .query_map(params![], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, f64>(2)?,
                ))
            })
            .map_err(|e| map_db_err(e.into()))?;
        for row in rows {
            let (space_id, prompt_id, position) = row.map_err(|e| map_db_err(e.into()))?;
            out.push(BackfillItem {
                scope: AttachScope::Space(space_id),
                prompt_id,
                position,
            });
        }
    }

    Ok(out)
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
    fn run_if_pending_is_idempotent() {
        let pool = fresh_pool();
        // Seed: a space, board, column, role, two tasks attached to the role,
        // and one prompt attached at each of the four scopes.
        {
            let conn = acquire(&pool).unwrap();
            conn.execute_batch(
                "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                     VALUES ('sp', 'S', 'sp', 0, 0, 0, 0); \
                 INSERT INTO boards (id, name, space_id, position, created_at, updated_at, owner_role_id) \
                     VALUES ('bd', 'B', 'sp', 0, 0, 0, 'maintainer-system'); \
                 INSERT INTO columns (id, board_id, name, position, created_at) \
                     VALUES ('co', 'bd', 'C', 0, 0); \
                 INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl', 'R', '', 0, 0); \
                 INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p-r', 'pr', '', 0, 0), \
                     ('p-c', 'pc', '', 0, 0), \
                     ('p-b', 'pb', '', 0, 0), \
                     ('p-s', 'ps', '', 0, 0); \
                 INSERT INTO tasks (id, board_id, column_id, slug, title, position, role_id, created_at, updated_at) VALUES \
                     ('t1', 'bd', 'co', 'sp-1', 'T1', 0, 'rl', 0, 0), \
                     ('t2', 'bd', 'co', 'sp-2', 'T2', 1, 'rl', 0, 0); \
                 INSERT INTO role_prompts (role_id, prompt_id, position) VALUES ('rl', 'p-r', 1.0); \
                 INSERT INTO board_prompts (board_id, prompt_id, position) VALUES ('bd', 'p-b', 1); \
                 INSERT INTO column_prompts (column_id, prompt_id, position) VALUES ('co', 'p-c', 1); \
                 INSERT INTO space_prompts (space_id, prompt_id, position) VALUES ('sp', 'p-s', 1.0);",
            )
            .unwrap();
        }

        // First run: materialises 8 rows (4 scopes * 2 tasks).
        let n = run_if_pending(&pool).unwrap();
        assert_eq!(n, 8);

        // Second run: flag set → exit early, no new rows.
        let n2 = run_if_pending(&pool).unwrap();
        assert_eq!(n2, 0);

        // Counts on task_prompts.
        let conn = acquire(&pool).unwrap();
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_prompts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 8, "exactly 8 cascaded rows expected");
    }

    #[test]
    fn run_if_pending_no_op_when_flag_already_set() {
        let pool = fresh_pool();
        {
            let conn = acquire(&pool).unwrap();
            settings::set_setting(&conn, BACKFILL_FLAG_KEY, "true").unwrap();
        }
        let n = run_if_pending(&pool).unwrap();
        assert_eq!(n, 0);
    }
}
