//! End-to-end integration test: golden Promptery v0.4 fixture →
//! fresh Catique DB.
//!
//! Per migration plan v0.5 §11 step 11 / decision-log D-029. Asserts
//! the row-counts contract baked into D-019 §AC-2:
//!
//! ```text
//! spaces=10, boards=50, columns=200, tasks=1000, prompts=100,
//! roles=12, skills=8, mcp_tools=6, tags=8, prompt_groups=6,
//! tasks_fts=1000, agent_reports_fts=50
//! ```
//!
//! Plus the AC-1 "10 s budget on M1" sanity-print: we don't fail the
//! test on a slow CI runner (Linux on shared GitHub Actions can blow
//! that budget on a cold cache), but we print the actual elapsed time
//! to stdout so the operator can confirm it on their reference HW.
//!
//! Skipped quietly if the golden fixture is absent — keeps `cargo test`
//! green on stripped-down checkouts.

use std::path::PathBuf;
use std::time::Instant;

use catique_application::import::ImportUseCase;
use catique_domain::ImportOptions;
use rusqlite::Connection;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/promptery-v0.4-golden.sqlite")
}

fn unique_target_dir(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    let dir = std::env::temp_dir().join(format!(
        "catique-import-it-{}-{label}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap_or(-1)
}

#[test]
fn import_golden_fixture_into_fresh_catique_db() {
    let golden = fixture_path();
    if !golden.exists() {
        eprintln!("[skip] golden fixture absent: {}", golden.display());
        return;
    }

    let target = unique_target_dir("roundtrip");
    let uc = ImportUseCase::new(&target);

    let started = Instant::now();
    let report = uc
        .import(Some(&golden), &ImportOptions::default())
        .expect("import must succeed on golden fixture");
    let elapsed = started.elapsed();

    // ---- AC-1: 10 s on M1 (info-only on shared CI) ----
    eprintln!("[ac-1] golden-fixture import elapsed: {elapsed:?} (target <=10 s on M1)");

    // ---- Preflight: every PF passed ----
    assert!(
        report.preflight.all_ok(),
        "preflight: {:?}",
        report.preflight
    );

    // ---- D-019 row-count contract ----
    let final_db = report
        .commit_path
        .as_deref()
        .expect("real import must populate commit_path");
    let conn = Connection::open(final_db).expect("open final db");

    assert_eq!(count(&conn, "spaces"), 10, "spaces");
    assert_eq!(count(&conn, "space_counters"), 10, "space_counters");
    assert_eq!(count(&conn, "boards"), 50, "boards");
    assert_eq!(count(&conn, "columns"), 200, "columns");
    assert_eq!(count(&conn, "tasks"), 1000, "tasks");
    assert_eq!(count(&conn, "prompts"), 100, "prompts");
    assert_eq!(count(&conn, "roles"), 12, "roles");
    assert_eq!(count(&conn, "skills"), 8, "skills");
    assert_eq!(count(&conn, "mcp_tools"), 6, "mcp_tools");
    assert_eq!(count(&conn, "tags"), 8, "tags");
    assert_eq!(count(&conn, "prompt_groups"), 6, "prompt_groups");
    assert_eq!(count(&conn, "agent_reports"), 50, "agent_reports");

    // ---- FTS rebuild contract (D-029 #4) ----
    assert_eq!(count(&conn, "tasks_fts"), 1000, "tasks_fts");
    assert_eq!(count(&conn, "agent_reports_fts"), 50, "agent_reports_fts");

    // ---- Report-side counters mirror DB ----
    assert_eq!(report.rows_imported["tasks"], 1000);
    assert_eq!(report.rows_imported["boards"], 50);
    assert_eq!(report.rows_imported["prompts"], 100);
    assert_eq!(report.rows_imported["roles"], 12);
    assert_eq!(report.fts_rows_rebuilt["tasks_fts"], 1000);
    assert_eq!(report.fts_rows_rebuilt["agent_reports_fts"], 50);

    // ---- Spot-checks: at least one prompt has non-empty body, all 50
    //      boards have non-empty names + non-null space_id ----
    let nonempty_prompts: i64 = conn
        .query_row(
            "SELECT count(*) FROM prompts WHERE length(content) > 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(nonempty_prompts > 0, "at least one prompt must have body");

    let bad_boards: i64 = conn
        .query_row(
            "SELECT count(*) FROM boards WHERE name IS NULL OR name = '' OR space_id IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bad_boards, 0, "every board has non-empty name + space_id");

    // ---- FK integrity sanity sweep ----
    let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
    let mut rows = stmt.query([]).unwrap();
    if let Some(row) = rows.next().unwrap() {
        let bad_table: String = row.get(0).unwrap();
        panic!("post-import FK check failed for table {bad_table}");
    }

    // ---- Schema match ----
    assert!(report.schema_match, "schema_match");
    assert!(!report.dry_run);

    let _ = std::fs::remove_dir_all(&target);
}

#[test]
fn dry_run_reports_full_counts_but_no_target_db() {
    let golden = fixture_path();
    if !golden.exists() {
        return;
    }
    let target = unique_target_dir("dryrun-it");
    let uc = ImportUseCase::new(&target);
    let report = uc
        .import(
            Some(&golden),
            &ImportOptions {
                dry_run: true,
                overwrite_existing: false,
            },
        )
        .expect("dry-run import");
    assert!(report.dry_run);
    assert!(report.commit_path.is_none());
    assert_eq!(report.rows_imported["tasks"], 1000);
    assert!(!target.join("db.sqlite").exists());
    assert!(!target.join(".import-tmp").exists());
    let _ = std::fs::remove_dir_all(&target);
}
