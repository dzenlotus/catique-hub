//! Prompts repository — reusable text fragments.
//!
//! Schema: `001_initial.sql`, Promptery v0.4 lines 44-57. The
//! repository also owns the `prompt_group_members` (lines 209-219) and
//! `board_prompts` / `column_prompts` (lines 154-166) link helpers.
//! `prompt_tags` lives on the `tags` repository because tags are the
//! "owner" side of that join (per wave-brief).
//!
//! Wave-E2.4 (Olga): full CRUD on `prompts`. The 6-source inheritance
//! resolver is **deferred to E3** — at this layer we just store the
//! rows.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `prompts` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptRow {
    pub id: String,
    pub name: String,
    pub content: String,
    pub color: Option<String>,
    pub short_description: Option<String>,
    pub token_count: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl PromptRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            content: row.get("content")?,
            color: row.get("color")?,
            short_description: row.get("short_description")?,
            token_count: row.get("token_count")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new prompt.
#[derive(Debug, Clone)]
pub struct PromptDraft {
    pub name: String,
    pub content: String,
    pub color: Option<String>,
    pub short_description: Option<String>,
    /// Cached token count of `content` (cl100k_base in Promptery).
    /// Catique computes this in the use-case layer (E3) — for now the
    /// caller may pass `None` and the row gets a NULL `token_count`.
    pub token_count: Option<i64>,
}

/// Partial update payload.
#[derive(Debug, Clone, Default)]
pub struct PromptPatch {
    pub name: Option<String>,
    pub content: Option<String>,
    pub color: Option<Option<String>>,
    pub short_description: Option<Option<String>>,
    pub token_count: Option<Option<i64>>,
}

/// `SELECT … FROM prompts ORDER BY name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<PromptRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, content, color, short_description, token_count, created_at, updated_at \
         FROM prompts ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], PromptRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup by primary key.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<PromptRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, content, color, short_description, token_count, created_at, updated_at \
         FROM prompts WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], PromptRow::from_row)
        .optional()?)
}

/// Insert one prompt. Generates id, stamps timestamps.
///
/// # Errors
///
/// UNIQUE(name) violation surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &PromptDraft) -> Result<PromptRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO prompts \
            (id, name, content, color, short_description, token_count, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            draft.name,
            draft.content,
            draft.color,
            draft.short_description,
            draft.token_count,
            now
        ],
    )?;
    Ok(PromptRow {
        id,
        name: draft.name.clone(),
        content: draft.content.clone(),
        color: draft.color.clone(),
        short_description: draft.short_description.clone(),
        token_count: draft.token_count,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update via `COALESCE`. Bumps `updated_at`.
///
/// `color` / `short_description` / `token_count` are
/// `Option<Option<…>>` — see the spaces repo doc for the encoding
/// convention.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &PromptPatch,
) -> Result<Option<PromptRow>, DbError> {
    use std::fmt::Write as _;
    // Five nullable fields (color, short_description, token_count) make
    // a single `UPDATE … COALESCE …` quickly unreadable. We branch on
    // the three Option<Option<…>> fields independently — at most 8
    // combinations, every one is a straight UPDATE statement that
    // SQLite optimises identically. The `name` / `content` fields keep
    // the COALESCE pattern.
    let now = now_millis();
    let color_new = patch.color.as_ref();
    let desc_new = patch.short_description.as_ref();
    let tok_new = patch.token_count.as_ref();

    let mut sql = String::from(
        "UPDATE prompts SET name = COALESCE(?1, name), content = COALESCE(?2, content)",
    );
    let mut next_param = 3_usize;
    let mut params_vec: Vec<rusqlite::types::Value> =
        vec![patch.name.clone().into(), patch.content.clone().into()];
    if let Some(c) = color_new {
        let _ = write!(sql, ", color = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(c.clone()));
        next_param += 1;
    }
    if let Some(d) = desc_new {
        let _ = write!(sql, ", short_description = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(d.clone()));
        next_param += 1;
    }
    if let Some(t) = tok_new {
        let _ = write!(sql, ", token_count = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(*t));
        next_param += 1;
    }
    let _ = write!(
        sql,
        ", updated_at = ?{next_param} WHERE id = ?{}",
        next_param + 1
    );
    params_vec.push(rusqlite::types::Value::from(now));
    params_vec.push(rusqlite::types::Value::from(id.to_owned()));

    let updated = conn.execute(&sql, rusqlite::params_from_iter(params_vec.iter()))?;
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one prompt by id. Cascades to all link tables (role_prompts,
/// task_prompts, board_prompts, column_prompts, prompt_tags,
/// prompt_group_members, task_prompt_overrides).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM prompts WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------
// Join-table helpers — board_prompts, column_prompts, prompt_group_members.
// (role_prompts/task_prompts/prompt_tags live on their owner repos.)
// ---------------------------------------------------------------------

/// Attach a prompt to a board.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_board_prompt(
    conn: &Connection,
    board_id: &str,
    prompt_id: &str,
    position: i64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO board_prompts (board_id, prompt_id, position) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(board_id, prompt_id) DO UPDATE SET position = excluded.position",
        params![board_id, prompt_id, position],
    )?;
    Ok(())
}

/// Detach a prompt from a board.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_board_prompt(
    conn: &Connection,
    board_id: &str,
    prompt_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM board_prompts WHERE board_id = ?1 AND prompt_id = ?2",
        params![board_id, prompt_id],
    )?;
    Ok(n > 0)
}

/// Attach a prompt to a column.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_column_prompt(
    conn: &Connection,
    column_id: &str,
    prompt_id: &str,
    position: i64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO column_prompts (column_id, prompt_id, position) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(column_id, prompt_id) DO UPDATE SET position = excluded.position",
        params![column_id, prompt_id, position],
    )?;
    Ok(())
}

/// Detach a prompt from a column.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_column_prompt(
    conn: &Connection,
    column_id: &str,
    prompt_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM column_prompts WHERE column_id = ?1 AND prompt_id = ?2",
        params![column_id, prompt_id],
    )?;
    Ok(n > 0)
}

/// Add a prompt to a prompt-group.
///
/// # Errors
///
/// FK violation surfaces as [`DbError::Sqlite`].
pub fn add_prompt_group_member(
    conn: &Connection,
    group_id: &str,
    prompt_id: &str,
    position: i64,
) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO prompt_group_members (group_id, prompt_id, position, added_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(group_id, prompt_id) DO UPDATE SET position = excluded.position",
        params![group_id, prompt_id, position, now],
    )?;
    Ok(())
}

/// Remove a prompt from a prompt-group.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_prompt_group_member(
    conn: &Connection,
    group_id: &str,
    prompt_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM prompt_group_members WHERE group_id = ?1 AND prompt_id = ?2",
        params![group_id, prompt_id],
    )?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn draft(name: &str) -> PromptDraft {
        PromptDraft {
            name: name.into(),
            content: format!("body of {name}"),
            color: Some("#abcdef".into()),
            short_description: Some("desc".into()),
            token_count: Some(42),
        }
    }

    #[test]
    fn insert_then_get() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("p1")).unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
    }

    #[test]
    fn unique_name_violation() {
        let conn = fresh_db();
        insert(&conn, &draft("dup")).unwrap();
        let err = insert(&conn, &draft("dup")).expect_err("UNIQUE");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("p")).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &PromptPatch {
                name: Some("renamed".into()),
                content: Some("new".into()),
                ..PromptPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.content, "new");
        assert_eq!(updated.short_description.as_deref(), Some("desc")); // unchanged
    }

    #[test]
    fn update_can_clear_short_description() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("p")).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &PromptPatch {
                short_description: Some(None),
                ..PromptPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.short_description, None);
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("p")).unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        assert!(update(&conn, "ghost", &PromptPatch::default())
            .unwrap()
            .is_none());
    }
}
