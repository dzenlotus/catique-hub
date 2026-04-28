//! FTS5 search repository.
//!
//! Exposes two query functions over the FTS5 virtual tables created in
//! `001_initial.sql`:
//!   * `tasks_fts`        — indexed columns: `title`, `description`
//!   * `agent_reports_fts` — indexed columns: `title`, `content`
//!
//! **Query sanitisation**: user input is never string-concatenated into
//! SQL. The `fts5_quote` helper wraps each whitespace-delimited term in
//! double-quotes and escapes any embedded `"` by doubling it, then emits
//! the terms as a single quoted-phrase match expression (e.g. user input
//! `foo "bar"` → FTS5 query `"foo" """bar"""`). This prevents any FTS5
//! operator (`OR`, `NEAR`, `*`, `^`, `-`) from being interpreted.
//!
//! **Limit**: default 50, hard cap 200. Callers that pass `None` get the
//! default; values above 200 are silently clamped.
//!
//! **FTS column index mapping** (for `snippet()`):
//!   * `tasks_fts`:          col 0 = task_id (UNINDEXED), col 1 = title, col 2 = description
//!   * `agent_reports_fts`:  col 0 = report_id (UNINDEXED), col 1 = title, col 2 = content
//!
//! We pass column index `1` (title) to `snippet()` so the fragment
//! always comes from a human-readable field.

use rusqlite::{params, Connection};

use catique_domain::SearchResult;

use crate::db::pool::DbError;

/// Default result limit per search call.
pub const DEFAULT_LIMIT: i64 = 50;
/// Hard upper bound — prevents runaway result sets.
pub const MAX_LIMIT: i64 = 200;

/// Resolves `limit_opt` to a value in `[1, MAX_LIMIT]`.
fn resolve_limit(limit_opt: Option<i64>) -> i64 {
    match limit_opt {
        None => DEFAULT_LIMIT,
        Some(n) if n < 1 => 1,
        Some(n) if n > MAX_LIMIT => MAX_LIMIT,
        Some(n) => n,
    }
}

/// Quote a user-supplied string as a safe FTS5 query expression.
///
/// Algorithm:
/// 1. Trim leading/trailing whitespace.
/// 2. Split on ASCII whitespace.
/// 3. Wrap each non-empty term in `"…"`, escaping any `"` inside the
///    term by doubling it (`"` → `""`), per the FTS5 spec.
/// 4. Join terms with a space — FTS5 treats adjacent quoted phrases as
///    an implicit AND.
///
/// Returns `None` when the input is empty after trimming (signals "no
/// query — skip the DB call").
#[must_use]
pub fn fts5_quote(query: &str) -> Option<String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }
    let quoted = trimmed
        .split_ascii_whitespace()
        .map(|term| {
            let escaped = term.replace('"', "\"\"");
            format!("\"{escaped}\"")
        })
        .collect::<Vec<_>>()
        .join(" ");
    Some(quoted)
}

/// Search the `tasks_fts` virtual table. JOINs with `tasks` to fetch
/// `board_id` and `column_id`. Uses `snippet()` on the `title` column
/// (index 1).
///
/// # Errors
///
/// Surfaces rusqlite errors as [`DbError::Sqlite`].
pub fn search_tasks(
    conn: &Connection,
    query: &str,
    limit: Option<i64>,
) -> Result<Vec<SearchResult>, DbError> {
    let Some(fts_query) = fts5_quote(query) else {
        return Ok(Vec::new());
    };
    let lim = resolve_limit(limit);

    // snippet(fts_table, col_index, open_tag, close_tag, ellipsis, max_tokens)
    // col 1 = title (the first indexed column after the UNINDEXED task_id).
    let mut stmt = conn.prepare(
        "SELECT t.id, t.board_id, t.column_id, t.title, \
                snippet(tasks_fts, 1, '<b>', '</b>', '…', 16) AS snippet \
         FROM tasks_fts \
         JOIN tasks t ON t.id = tasks_fts.task_id \
         WHERE tasks_fts MATCH ?1 \
         ORDER BY tasks_fts.rank \
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![fts_query, lim], |row| {
        Ok(SearchResult::Task {
            id: row.get(0)?,
            board_id: row.get(1)?,
            column_id: row.get(2)?,
            title: row.get(3)?,
            snippet: row.get(4)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Search the `agent_reports_fts` virtual table. JOINs with
/// `agent_reports` to fetch `task_id` and `kind`. Uses `snippet()` on
/// the `title` column (index 1).
///
/// # Errors
///
/// Surfaces rusqlite errors as [`DbError::Sqlite`].
pub fn search_agent_reports(
    conn: &Connection,
    query: &str,
    limit: Option<i64>,
) -> Result<Vec<SearchResult>, DbError> {
    let Some(fts_query) = fts5_quote(query) else {
        return Ok(Vec::new());
    };
    let lim = resolve_limit(limit);

    // col 1 = title (the first indexed column after the UNINDEXED report_id).
    let mut stmt = conn.prepare(
        "SELECT ar.id, ar.task_id, ar.title, ar.kind, \
                snippet(agent_reports_fts, 1, '<b>', '</b>', '…', 16) AS snippet \
         FROM agent_reports_fts \
         JOIN agent_reports ar ON ar.id = agent_reports_fts.report_id \
         WHERE agent_reports_fts MATCH ?1 \
         ORDER BY agent_reports_fts.rank \
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![fts_query, lim], |row| {
        Ok(SearchResult::AgentReport {
            id: row.get(0)?,
            task_id: row.get(1)?,
            title: row.get(2)?,
            kind: row.get(3)?,
            snippet: row.get(4)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    /// Build a fresh in-memory DB with the full schema and a minimal set of
    /// rows: one space → one board → one column → tasks/reports as needed.
    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','C',0,0);",
        )
        .unwrap();
        conn
    }

    fn insert_task(conn: &Connection, id: &str, title: &str, description: &str) {
        conn.execute(
            "INSERT INTO tasks \
                 (id, board_id, column_id, slug, title, description, position, created_at, updated_at) \
             VALUES (?1, 'bd1', 'c1', ?2, ?3, ?4, 0, 0, 0)",
            params![id, format!("sp-{id}"), title, description],
        )
        .unwrap();
    }

    fn insert_report(conn: &Connection, id: &str, task_id: &str, title: &str, content: &str) {
        conn.execute(
            "INSERT INTO agent_reports \
                 (id, task_id, kind, title, content, created_at, updated_at) \
             VALUES (?1, ?2, 'summary', ?3, ?4, 0, 0)",
            params![id, task_id, title, content],
        )
        .unwrap();
    }

    // ------------------------------------------------------------------
    // fts5_quote helper
    // ------------------------------------------------------------------

    #[test]
    fn fts5_quote_empty_returns_none() {
        assert!(fts5_quote("").is_none());
        assert!(fts5_quote("   ").is_none());
    }

    #[test]
    fn fts5_quote_single_term() {
        assert_eq!(fts5_quote("hello"), Some("\"hello\"".into()));
    }

    #[test]
    fn fts5_quote_multi_term() {
        assert_eq!(fts5_quote("foo bar"), Some("\"foo\" \"bar\"".into()));
    }

    #[test]
    fn fts5_quote_escapes_inner_double_quotes() {
        // User typed: OR "special"
        // Expected:   "OR" """special"""
        let result = fts5_quote(r#"OR "special""#).unwrap();
        assert_eq!(result, r#""OR" """special""""#);
    }

    #[test]
    fn fts5_quote_fts5_operators_are_neutralised() {
        // FTS5 special tokens must not be interpreted
        let result = fts5_quote("NEAR AND OR NOT *").unwrap();
        assert_eq!(result, r#""NEAR" "AND" "OR" "NOT" "*""#);
    }

    // ------------------------------------------------------------------
    // search_tasks
    // ------------------------------------------------------------------

    #[test]
    fn search_tasks_empty_query_returns_empty() {
        let conn = fresh_db();
        insert_task(&conn, "t1", "Hello world", "nothing");
        let results = search_tasks(&conn, "", None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_tasks_single_term_match() {
        let conn = fresh_db();
        insert_task(&conn, "t1", "Refactor authentication", "oauth2 flow");
        insert_task(&conn, "t2", "Write docs", "documentation");
        let results = search_tasks(&conn, "Refactor", None).unwrap();
        assert_eq!(results.len(), 1);
        match &results[0] {
            SearchResult::Task { id, title, .. } => {
                assert_eq!(id, "t1");
                assert_eq!(title, "Refactor authentication");
            }
            other @ SearchResult::AgentReport { .. } => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn search_tasks_multi_term_match() {
        let conn = fresh_db();
        insert_task(&conn, "t1", "Implement search feature", "fts5 full text");
        insert_task(&conn, "t2", "Fix login bug", "password reset");
        // Both terms must match (implicit AND after quoting)
        let results = search_tasks(&conn, "Implement feature", None).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_tasks_no_match_returns_empty() {
        let conn = fresh_db();
        insert_task(&conn, "t1", "Update styles", "css variables");
        let results = search_tasks(&conn, "unrelated_unique_xyz", None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_tasks_fts5_special_chars_safe() {
        let conn = fresh_db();
        insert_task(&conn, "t1", "Normal task", "body");
        // Input that would crash if not properly quoted
        let results = search_tasks(&conn, "OR NEAR * ^", None).unwrap();
        // We just assert it doesn't panic/error — results may be empty or not
        drop(results);
    }

    #[test]
    fn search_tasks_limit_respected() {
        let conn = fresh_db();
        for i in 0..10 {
            insert_task(
                &conn,
                &format!("t{i}"),
                &format!("common keyword task {i}"),
                "",
            );
        }
        let results = search_tasks(&conn, "common", Some(3)).unwrap();
        assert!(results.len() <= 3);
    }

    // ------------------------------------------------------------------
    // search_agent_reports
    // ------------------------------------------------------------------

    #[test]
    fn search_reports_empty_query_returns_empty() {
        let conn = fresh_db();
        insert_task(&conn, "t1", "T", "");
        insert_report(&conn, "r1", "t1", "Investigation report", "finding details");
        let results = search_agent_reports(&conn, "   ", None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_reports_single_term_match() {
        let conn = fresh_db();
        insert_task(&conn, "t1", "T", "");
        insert_report(&conn, "r1", "t1", "Security investigation", "XSS found");
        insert_report(&conn, "r2", "t1", "Performance plan", "load testing");
        let results = search_agent_reports(&conn, "Security", None).unwrap();
        assert_eq!(results.len(), 1);
        match &results[0] {
            SearchResult::AgentReport {
                id, task_id, kind, ..
            } => {
                assert_eq!(id, "r1");
                assert_eq!(task_id, "t1");
                assert_eq!(kind, "summary");
            }
            other @ SearchResult::Task { .. } => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn search_reports_fts5_special_chars_safe() {
        let conn = fresh_db();
        insert_task(&conn, "t1", "T", "");
        insert_report(&conn, "r1", "t1", "Normal report", "content");
        // Should not panic or error
        let _ = search_agent_reports(&conn, "* OR NEAR", None).unwrap();
    }

    // ------------------------------------------------------------------
    // resolve_limit
    // ------------------------------------------------------------------

    #[test]
    fn resolve_limit_none_gives_default() {
        assert_eq!(resolve_limit(None), DEFAULT_LIMIT);
    }

    #[test]
    fn resolve_limit_caps_at_max() {
        assert_eq!(resolve_limit(Some(999)), MAX_LIMIT);
    }

    #[test]
    fn resolve_limit_clamps_zero_to_one() {
        assert_eq!(resolve_limit(Some(0)), 1);
        assert_eq!(resolve_limit(Some(-5)), 1);
    }

    #[test]
    fn resolve_limit_passthrough_in_range() {
        assert_eq!(resolve_limit(Some(10)), 10);
    }
}
