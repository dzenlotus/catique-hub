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
    pub position: i64,
}

/// Partial update payload.
///
/// `color` is `Option<Option<String>>` — `None` = leave unchanged,
/// `Some(None)` = set to NULL, `Some(Some(c))` = set to a new value.
#[derive(Debug, Clone, Default)]
pub struct PromptGroupPatch {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
    pub position: Option<i64>,
}

/// List all groups ordered by `position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list(conn: &Connection) -> Result<Vec<PromptGroupRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, position, created_at, updated_at \
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
        "SELECT id, name, color, position, created_at, updated_at \
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
        "INSERT INTO prompt_groups (id, name, color, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, draft.name, draft.color, draft.position, now],
    )?;
    Ok(PromptGroupRow {
        id,
        name: draft.name.clone(),
        color: draft.color.clone(),
        position: draft.position,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Bumps `updated_at` regardless.
///
/// Uses `COALESCE` for non-nullable `name` and `position`.
/// `color` is handled via a conditional branch because it is nullable.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &PromptGroupPatch,
) -> Result<Option<PromptGroupRow>, DbError> {
    let now = now_millis();
    let updated = match &patch.color {
        Some(new_color) => conn.execute(
            "UPDATE prompt_groups SET \
                 name = COALESCE(?1, name), \
                 color = ?2, \
                 position = COALESCE(?3, position), \
                 updated_at = ?4 \
             WHERE id = ?5",
            params![patch.name, new_color, patch.position, now, id],
        )?,
        None => conn.execute(
            "UPDATE prompt_groups SET \
                 name = COALESCE(?1, name), \
                 position = COALESCE(?2, position), \
                 updated_at = ?3 \
             WHERE id = ?4",
            params![patch.name, patch.position, now, id],
        )?,
    };
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
                position: 1,
            },
        )
        .unwrap();
        insert(
            &conn,
            &PromptGroupDraft {
                name: "A".into(),
                color: None,
                position: 0,
            },
        )
        .unwrap();
        insert(
            &conn,
            &PromptGroupDraft {
                name: "C".into(),
                color: None,
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
}
