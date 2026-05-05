//! Prompt-groups repository — named collections of prompts.
//!
//! Schema: `001_initial.sql` section 9 (Promptery v0.4 lines 200-219).
//!
//! Tables:
//!   * `prompt_groups`       — the group entity.
//!   * `prompt_group_members`— join table; has `ON DELETE CASCADE` on
//!     `group_id` so deleting a group automatically removes its members.
//!     `added_at INTEGER NOT NULL` is stamped on every insert.
//!
//! Schema notes:
//!   * `position` is `INTEGER NOT NULL DEFAULT 0` (not REAL).
//!   * No `UNIQUE` constraint on `name` in the schema — de-dup is
//!     left to the application layer if desired.
//!   * `prompt_group_members` PK is `(group_id, prompt_id)`.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `prompt_groups` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptGroupRow {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    /// Optional pixel-icon identifier (migration `007_prompt_group_icons.sql`).
    /// The frontend maps this string onto a React component from
    /// `src/shared/ui/Icon/`.
    pub icon: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl PromptGroupRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            icon: row.get("icon")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new group.
#[derive(Debug, Clone)]
pub struct PromptGroupDraft {
    pub name: String,
    pub color: Option<String>,
    /// Pixel-icon identifier (`None` means no icon).
    pub icon: Option<String>,
    pub position: i64,
}

/// Partial update payload.
///
/// `color` and `icon` are `Option<Option<String>>` — `None` = leave
/// unchanged, `Some(None)` = set to NULL, `Some(Some(s))` = set to a
/// new value.
#[derive(Debug, Clone, Default)]
pub struct PromptGroupPatch {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
    /// `None` = leave alone; `Some(None)` = clear; `Some(Some(s))` = set.
    pub icon: Option<Option<String>>,
    pub position: Option<i64>,
}

/// List all groups ordered by `position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list(conn: &Connection) -> Result<Vec<PromptGroupRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, icon, position, created_at, updated_at \
         FROM prompt_groups ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], PromptGroupRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Look up one group by primary key.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get(conn: &Connection, id: &str) -> Result<Option<PromptGroupRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, icon, position, created_at, updated_at \
         FROM prompt_groups WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], PromptGroupRow::from_row)
        .optional()?)
}

/// Insert one group. Generates id, stamps timestamps.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn insert(conn: &Connection, draft: &PromptGroupDraft) -> Result<PromptGroupRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO prompt_groups \
            (id, name, color, icon, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            id,
            draft.name,
            draft.color,
            draft.icon,
            draft.position,
            now
        ],
    )?;
    Ok(PromptGroupRow {
        id,
        name: draft.name.clone(),
        color: draft.color.clone(),
        icon: draft.icon.clone(),
        position: draft.position,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Bumps `updated_at` regardless.
///
/// Uses `COALESCE` for the non-nullable `name` and `position` columns.
/// `color` and `icon` are nullable, so they are appended to the SQL
/// only when the patch carries an explicit `Some(_)` — `Some(None)`
/// clears the column, `Some(Some(s))` sets it.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &PromptGroupPatch,
) -> Result<Option<PromptGroupRow>, DbError> {
    use std::fmt::Write as _;
    let now = now_millis();
    let color_new = patch.color.as_ref();
    let icon_new = patch.icon.as_ref();

    let mut sql = String::from(
        "UPDATE prompt_groups SET name = COALESCE(?1, name), \
         position = COALESCE(?2, position)",
    );
    let mut next_param = 3_usize;
    let mut params_vec: Vec<rusqlite::types::Value> = vec![
        patch.name.clone().into(),
        patch.position.into(),
    ];
    if let Some(c) = color_new {
        let _ = write!(sql, ", color = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(c.clone()));
        next_param += 1;
    }
    if let Some(i) = icon_new {
        let _ = write!(sql, ", icon = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(i.clone()));
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
    get(conn, id)
}

/// Delete one group by id. The `ON DELETE CASCADE` on
/// `prompt_group_members.group_id` removes member rows automatically.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM prompt_groups WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

// -------------------------------------------------------------------------
// Member operations — prompt_group_members join table.
// -------------------------------------------------------------------------

/// Return the ordered list of `prompt_id` values for a group.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_members(conn: &Connection, group_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT prompt_id FROM prompt_group_members \
         WHERE group_id = ?1 ORDER BY position ASC",
    )?;
    let rows = stmt.query_map(params![group_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Upsert a prompt into a group at the given position.
///
/// Uses `ON CONFLICT … DO UPDATE` so calling this twice with different
/// positions updates the position idempotently.
///
/// # Errors
///
/// FK violation (unknown `group_id` or `prompt_id`) surfaces as
/// [`DbError::Sqlite`].
pub fn add_member(
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

/// Remove a prompt from a group. Returns `true` if a row was deleted.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_member(conn: &Connection, group_id: &str, prompt_id: &str) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM prompt_group_members WHERE group_id = ?1 AND prompt_id = ?2",
        params![group_id, prompt_id],
    )?;
    Ok(n > 0)
}

/// Atomically replace the full ordered member list.
///
/// Deletes all existing members for the group, then re-inserts
/// `ordered_prompt_ids` with `position = 1..=N`. Wrapped in a
/// `SAVEPOINT` so the operation is atomic even when called on a
/// connection that is not already in a transaction.
///
/// # Errors
///
/// FK violation (unknown `prompt_id`) or any other rusqlite error.
pub fn set_members(
    conn: &Connection,
    group_id: &str,
    ordered_prompt_ids: &[String],
) -> Result<(), DbError> {
    conn.execute("SAVEPOINT set_members", [])?;
    let result = (|| -> Result<(), DbError> {
        conn.execute(
            "DELETE FROM prompt_group_members WHERE group_id = ?1",
            params![group_id],
        )?;
        let now = now_millis();
        for (idx, prompt_id) in ordered_prompt_ids.iter().enumerate() {
            #[allow(clippy::cast_possible_wrap)]
            let position = (idx + 1) as i64;
            conn.execute(
                "INSERT INTO prompt_group_members (group_id, prompt_id, position, added_at) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![group_id, prompt_id, position, now],
            )?;
        }
        Ok(())
    })();
    if result.is_ok() {
        conn.execute("RELEASE set_members", [])?;
    } else {
        conn.execute("ROLLBACK TO set_members", [])?;
        conn.execute("RELEASE set_members", [])?;
    }
    result
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

    fn draft(name: &str) -> PromptGroupDraft {
        PromptGroupDraft {
            name: name.into(),
            color: Some("#abcdef".into()),
            icon: None,
            position: 0,
        }
    }

    /// Insert a prompt row so FK constraints on `prompt_group_members` are
    /// satisfied.
    fn insert_prompt(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES (?1, ?2, '', 0, 0)",
            params![id, id],
        )
        .unwrap();
    }

    // ------------------------------------------------------------------
    // CRUD round-trip
    // ------------------------------------------------------------------

    #[test]
    fn insert_then_get() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g1")).unwrap();
        let got = get(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
    }

    #[test]
    fn list_ordered_by_position_then_name() {
        let conn = fresh_db();
        insert(
            &conn,
            &PromptGroupDraft {
                name: "B".into(),
                color: None,
                icon: None,
                position: 1,
            },
        )
        .unwrap();
        insert(
            &conn,
            &PromptGroupDraft {
                name: "A".into(),
                color: None,
                icon: None,
                position: 0,
            },
        )
        .unwrap();
        insert(
            &conn,
            &PromptGroupDraft {
                name: "C".into(),
                color: None,
                icon: None,
                position: 0,
            },
        )
        .unwrap();
        let rows = list(&conn).unwrap();
        // position 0: A, C (alphabetical); then position 1: B
        assert_eq!(rows[0].name, "A");
        assert_eq!(rows[1].name, "C");
        assert_eq!(rows[2].name, "B");
    }

    #[test]
    fn update_name_and_position() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("old")).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &PromptGroupPatch {
                name: Some("new".into()),
                position: Some(5),
                ..PromptGroupPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "new");
        assert_eq!(updated.position, 5);
        assert_eq!(updated.color, row.color); // unchanged
    }

    #[test]
    fn update_can_clear_color() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &PromptGroupPatch {
                color: Some(None),
                ..PromptGroupPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.color, None);
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        assert!(update(&conn, "ghost", &PromptGroupPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn delete_cascades_to_members() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        insert_prompt(&conn, "p1");
        add_member(&conn, &row.id, "p1", 1).unwrap();

        delete(&conn, &row.id).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM prompt_group_members WHERE group_id = ?1",
                params![row.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "cascade should have removed members");
    }

    // ------------------------------------------------------------------
    // Member add / list / remove
    // ------------------------------------------------------------------

    #[test]
    fn add_then_list_members() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        insert_prompt(&conn, "p1");
        insert_prompt(&conn, "p2");
        add_member(&conn, &row.id, "p2", 2).unwrap();
        add_member(&conn, &row.id, "p1", 1).unwrap();
        let members = list_members(&conn, &row.id).unwrap();
        assert_eq!(members, vec!["p1", "p2"]);
    }

    #[test]
    fn add_member_upserts_position() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        insert_prompt(&conn, "p1");
        add_member(&conn, &row.id, "p1", 1).unwrap();
        add_member(&conn, &row.id, "p1", 99).unwrap(); // upsert
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM prompt_group_members WHERE group_id = ?1",
                params![row.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let pos: i64 = conn
            .query_row(
                "SELECT position FROM prompt_group_members WHERE group_id = ?1 AND prompt_id = 'p1'",
                params![row.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pos, 99);
    }

    #[test]
    fn remove_member_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        insert_prompt(&conn, "p1");
        add_member(&conn, &row.id, "p1", 1).unwrap();
        assert!(remove_member(&conn, &row.id, "p1").unwrap());
        assert!(!remove_member(&conn, &row.id, "p1").unwrap());
    }

    // ------------------------------------------------------------------
    // set_members atomic replace
    // ------------------------------------------------------------------

    #[test]
    fn set_members_replaces_all() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        insert_prompt(&conn, "p1");
        insert_prompt(&conn, "p2");
        insert_prompt(&conn, "p3");

        add_member(&conn, &row.id, "p1", 1).unwrap();
        add_member(&conn, &row.id, "p2", 2).unwrap();

        // Replace with a different ordered set.
        set_members(&conn, &row.id, &["p3".into(), "p1".into()]).unwrap();

        let members = list_members(&conn, &row.id).unwrap();
        assert_eq!(members, vec!["p3", "p1"]);
    }

    #[test]
    fn set_members_empty_clears_all() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        insert_prompt(&conn, "p1");
        add_member(&conn, &row.id, "p1", 1).unwrap();

        set_members(&conn, &row.id, &[]).unwrap();

        assert!(list_members(&conn, &row.id).unwrap().is_empty());
    }

    #[test]
    fn set_members_rolls_back_on_bad_fk() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        insert_prompt(&conn, "p1");
        add_member(&conn, &row.id, "p1", 1).unwrap();

        // "ghost" does not exist in `prompts` — FK violation.
        let err = set_members(&conn, &row.id, &["ghost".into()]);
        assert!(err.is_err(), "expected FK error");

        // Original member should still be there (rollback).
        let members = list_members(&conn, &row.id).unwrap();
        assert_eq!(members, vec!["p1"]);
    }

    // ------------------------------------------------------------------
    // Icon round-trip — mirror of the `prompts` icon coverage.
    // ------------------------------------------------------------------

    #[test]
    fn icon_round_trips_through_insert_get_and_list() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &PromptGroupDraft {
                name: "iconic".into(),
                color: None,
                icon: Some("star".into()),
                position: 0,
            },
        )
        .unwrap();
        assert_eq!(row.icon.as_deref(), Some("star"));
        let got = get(&conn, &row.id).unwrap().unwrap();
        assert_eq!(got.icon.as_deref(), Some("star"));
        let all = list(&conn).unwrap();
        let listed = all.iter().find(|r| r.id == row.id).unwrap();
        assert_eq!(listed.icon.as_deref(), Some("star"));
    }

    #[test]
    fn icon_defaults_to_none_when_omitted() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("no-icon")).unwrap();
        assert_eq!(row.icon, None);
    }

    #[test]
    fn update_can_set_clear_and_change_icon() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("g")).unwrap();
        assert_eq!(row.icon, None);

        // Set.
        let after_set = update(
            &conn,
            &row.id,
            &PromptGroupPatch {
                icon: Some(Some("bolt".into())),
                ..PromptGroupPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_set.icon.as_deref(), Some("bolt"));

        // Change.
        let after_change = update(
            &conn,
            &row.id,
            &PromptGroupPatch {
                icon: Some(Some("heart".into())),
                ..PromptGroupPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_change.icon.as_deref(), Some("heart"));

        // Clear.
        let after_clear = update(
            &conn,
            &row.id,
            &PromptGroupPatch {
                icon: Some(None),
                ..PromptGroupPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_clear.icon, None);
    }
}
