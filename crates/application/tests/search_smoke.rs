//! Smoke integration test: insert one task + one agent report that share
//! a common keyword, then assert both appear in `search_all`.
//!
//! Uses an in-memory SQLite pool (same helper used by existing use-case
//! tests) so this test is hermetic and fast.

use catique_application::search::SearchUseCase;
use catique_domain::SearchResult;
use catique_infrastructure::db::pool::memory_pool_for_tests;
use catique_infrastructure::db::runner::run_pending;

fn fresh_pool() -> catique_infrastructure::db::pool::Pool {
    let pool = memory_pool_for_tests();
    let mut conn = pool.get().unwrap();
    run_pending(&mut conn).unwrap();
    conn.execute_batch(
        "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES ('sp1','Space','sp',0,0,0,0); \
         INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
             VALUES ('bd1','B','sp1',0,0,0); \
         INSERT INTO columns (id, board_id, name, position, created_at) \
             VALUES ('c1','bd1','C',0,0); \
         INSERT INTO tasks (id, board_id, column_id, slug, title, description, position, created_at, updated_at) \
             VALUES ('t1','bd1','c1','sp-t1','Catique search smoke test','catique full text search',0,0,0); \
         INSERT INTO agent_reports (id, task_id, kind, title, content, created_at, updated_at) \
             VALUES ('r1','t1','summary','Agent report catique','findings about catique fts',0,0);",
    )
    .unwrap();
    drop(conn);
    pool
}

#[test]
fn search_all_finds_task_and_report_for_shared_term() {
    let pool = fresh_pool();
    let uc = SearchUseCase::new(&pool);

    let results = uc
        .search_all("catique".into(), None)
        .expect("search_all must succeed");

    let task_hits: Vec<_> = results
        .iter()
        .filter(|r| matches!(r, SearchResult::Task { .. }))
        .collect();
    let report_hits: Vec<_> = results
        .iter()
        .filter(|r| matches!(r, SearchResult::AgentReport { .. }))
        .collect();

    assert_eq!(task_hits.len(), 1, "expected exactly one task hit");
    assert_eq!(report_hits.len(), 1, "expected exactly one report hit");

    // Verify fields are populated correctly
    match task_hits[0] {
        SearchResult::Task {
            id,
            board_id,
            column_id,
            title,
            snippet,
        } => {
            assert_eq!(id, "t1");
            assert_eq!(board_id, "bd1");
            assert_eq!(column_id, "c1");
            assert!(
                title.to_lowercase().contains("catique"),
                "title should contain search term"
            );
            assert!(!snippet.is_empty(), "snippet must be non-empty");
        }
        SearchResult::AgentReport { .. } => unreachable!(),
    }

    match report_hits[0] {
        SearchResult::AgentReport {
            id,
            task_id,
            title,
            kind,
            snippet,
        } => {
            assert_eq!(id, "r1");
            assert_eq!(task_id, "t1");
            assert!(title.to_lowercase().contains("catique"));
            assert_eq!(kind, "summary");
            assert!(!snippet.is_empty(), "snippet must be non-empty");
        }
        SearchResult::Task { .. } => unreachable!(),
    }
}

#[test]
fn search_tasks_only_returns_tasks() {
    let pool = fresh_pool();
    let uc = SearchUseCase::new(&pool);

    let results = uc
        .search_tasks("catique".into(), None)
        .expect("search_tasks must succeed");

    assert_eq!(results.len(), 1);
    assert!(matches!(results[0], SearchResult::Task { .. }));
}

#[test]
fn search_agent_reports_only_returns_reports() {
    let pool = fresh_pool();
    let uc = SearchUseCase::new(&pool);

    let results = uc
        .search_agent_reports("catique".into(), None)
        .expect("search_agent_reports must succeed");

    assert_eq!(results.len(), 1);
    assert!(matches!(results[0], SearchResult::AgentReport { .. }));
}

#[test]
fn search_all_empty_query_returns_empty() {
    let pool = fresh_pool();
    let uc = SearchUseCase::new(&pool);

    let results = uc
        .search_all(String::new(), None)
        .expect("empty query must not error");

    assert!(results.is_empty());
}

#[test]
fn search_all_no_match_returns_empty() {
    let pool = fresh_pool();
    let uc = SearchUseCase::new(&pool);

    let results = uc
        .search_all("zzz_no_match_xyz".into(), None)
        .expect("no-match search must not error");

    assert!(results.is_empty());
}
