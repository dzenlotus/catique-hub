//! Cross-connection integration test for the change_events bus
//! (catique-3).
//!
//! The bug surfaces when an external process (the standalone
//! `catique-hub-mcp` binary) writes a row from one OS process and the
//! Tauri shell's tail loop, in another process, fails to observe it.
//! We cannot spin up a sibling OS process inside a unit test cheaply,
//! but we can model the same SQLite contract: open two independent
//! `Connection`s to the same file-backed DB, write through one, tail
//! through the other.
//!
//! If WAL + the publisher / reader contract is correct, the second
//! connection sees committed rows from the first immediately. If this
//! test were to fail, it would localise the bug to the storage layer.
//! Today it passes — which narrows the original
//! "UI does not refresh on external MCP mutations" report to the
//! Tauri-shell tail / `AppHandle::emit` / EventsProvider hop. See
//! `docs/audit/` for follow-up debug hooks (`CATIQUE_EVENTLOG_DEBUG=1`,
//! tail heartbeat lines).

use catique_infrastructure::db::{event_log, pool};
use serde_json::json;
use tempfile::TempDir;

#[test]
fn separate_connections_to_same_wal_db_observe_each_others_commits() {
    let tmp = TempDir::new().expect("tmp dir");
    let db_path = tmp.path().join("catique-eventlog.sqlite3");

    // Pool A — "Tauri shell". Initialises migrations.
    let pool_a = pool::open(&db_path).expect("open pool a");
    {
        let mut conn = pool_a.get().expect("acquire");
        catique_infrastructure::db::runner::run_pending(&mut conn).expect("migrations");
    }

    // Pool B — "standalone mcp-server-bin". Same file, different
    // r2d2 pool to model an independent process.
    let pool_b = pool::open(&db_path).expect("open pool b");

    // Seed last_seen from pool A *before* B writes — mirrors the tail
    // loop, which reads `current_max_seq` at startup.
    let last_seen_initial = {
        let conn = pool_a.get().expect("acquire");
        event_log::current_max_seq(&conn).expect("max seq")
    };

    // Pool B publishes a few rows.
    {
        let conn = pool_b.get().expect("acquire pool b");
        for (name, id) in [
            ("task:created", "t1"),
            ("task:updated", "t1"),
            ("space:created", "s1"),
        ] {
            event_log::publish(&conn, name, &json!({ "id": id })).expect("publish");
        }
    }

    // Pool A tails — must observe all three rows.
    let conn = pool_a.get().expect("acquire pool a");
    let rows = event_log::tail(&conn, last_seen_initial, 200).expect("tail");
    let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["task:created", "task:updated", "space:created"],
        "cross-connection WAL contract: writer rows must be visible to a reader"
    );
}

#[test]
fn tail_advances_monotonically_across_multiple_polls() {
    let tmp = TempDir::new().expect("tmp dir");
    let db_path = tmp.path().join("catique-eventlog-2.sqlite3");

    let pool_a = pool::open(&db_path).expect("open pool a");
    {
        let mut conn = pool_a.get().expect("acquire");
        catique_infrastructure::db::runner::run_pending(&mut conn).expect("migrations");
    }
    let pool_b = pool::open(&db_path).expect("open pool b");

    // First batch.
    {
        let conn = pool_b.get().expect("acquire pool b");
        event_log::publish(&conn, "task:created", &json!({ "id": "a" })).unwrap();
        event_log::publish(&conn, "task:updated", &json!({ "id": "a" })).unwrap();
    }
    let mut last_seen = 0;
    {
        let conn = pool_a.get().expect("acquire");
        let rows = event_log::tail(&conn, last_seen, 200).expect("tail 1");
        assert_eq!(rows.len(), 2);
        last_seen = rows.last().unwrap().seq;
    }

    // Second batch — tail must skip past the first batch.
    {
        let conn = pool_b.get().expect("acquire pool b");
        event_log::publish(&conn, "task:deleted", &json!({ "id": "a" })).unwrap();
    }
    {
        let conn = pool_a.get().expect("acquire");
        let rows = event_log::tail(&conn, last_seen, 200).expect("tail 2");
        assert_eq!(rows.len(), 1, "tail must not re-deliver already-seen rows");
        assert_eq!(rows[0].name, "task:deleted");
        assert!(rows[0].seq > last_seen);
    }
}

#[test]
fn empty_tail_after_no_writes_is_no_op() {
    let tmp = TempDir::new().expect("tmp dir");
    let db_path = tmp.path().join("catique-eventlog-3.sqlite3");
    let pool = pool::open(&db_path).expect("open pool");
    {
        let mut conn = pool.get().expect("acquire");
        catique_infrastructure::db::runner::run_pending(&mut conn).expect("migrations");
    }
    let conn = pool.get().expect("acquire");
    let seed = event_log::current_max_seq(&conn).expect("seed");
    let rows = event_log::tail(&conn, seed, 200).expect("tail");
    assert!(rows.is_empty(), "no writes → no rows");
}
