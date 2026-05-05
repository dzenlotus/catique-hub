//! Skills repository — CRUD on the `skills` table.
//!
//! Schema: `001_initial.sql` (base columns) + `002_skills_mcp_tools.sql`
//! (description, position columns).

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `skills` table.
#[derive(Debug, Clone, PartialEq)]
pub struct SkillRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SkillRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            color: row.get("color")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new skill.
#[derive(Debug, Clone)]
pub struct SkillDraft {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub position: f64,
}

/// Partial update payload. `None` means "do not change". For nullable
/// `Option<String>` fields, `Some(None)` means "set to NULL".
#[derive(Debug, Clone, Default)]
pub struct SkillPatch {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub position: Option<f64>,
}

/// `SELECT … FROM skills ORDER BY position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<SkillRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, color, position, created_at, updated_at \
         FROM skills ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], SkillRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<SkillRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, color, position, created_at, updated_at \
         FROM skills WHERE id = ?1",
    )?;
    Ok(stmt.query_row(params![id], SkillRow::from_row).optional()?)
}

/// Insert one skill. Generates id, stamps timestamps.
///
/// # Errors
///
/// UNIQUE(name) violation surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &SkillDraft) -> Result<SkillRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO skills (id, name, description, color, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            id,
            draft.name,
            draft.description,
            draft.color,
            draft.position,
            now
        ],
    )?;
    Ok(SkillRow {
        id,
        name: draft.name.clone(),
        description: draft.description.clone(),
        color: draft.color.clone(),
        position: draft.position,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Bumps `updated_at` regardless.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &SkillPatch,
) -> Result<Option<SkillRow>, DbError> {
    let now = now_millis();

    // Build the SET clause dynamically to support nullable field patching.
    let mut clause_parts: Vec<String> = Vec::new();

    if patch.name.is_some() {
        clause_parts.push("name = COALESCE(?2, name)".into());
    }
    if patch.description.is_some() {
        clause_parts.push("description = ?3".into());
    }
    if patch.color.is_some() {
        clause_parts.push("color = ?4".into());
    }
    if patch.position.is_some() {
        clause_parts.push("position = COALESCE(?5, position)".into());
    }

    // We always bump updated_at; collect extra SET items first.
    let set_clause = if clause_parts.is_empty() {
        "updated_at = ?1".to_owned()
    } else {
        let mut all = clause_parts;
        all.push("updated_at = ?1".into());
        all.join(", ")
    };
    let sql = format!("UPDATE skills SET {set_clause} WHERE id = ?6");

    let description_val: Option<String> = patch.description.as_ref().and_then(Clone::clone);
    let color_val: Option<String> = patch.color.as_ref().and_then(Clone::clone);

    let updated = conn.execute(
        &sql,
        params![
            now,
            patch.name,
            description_val,
            color_val,
            patch.position,
            id
        ],
    )?;
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one skill by id. Cascades to `role_skills` and `task_skills`
/// via `ON DELETE CASCADE` defined in `001_initial.sql`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM skills WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

/// List every skill attached to `role_id`, joined from `skills`, ordered
/// by `role_skills.position ASC` (matches the `add_role_skill` insertion
/// contract in `roles.rs`).
///
/// ctq-117: cat (role) → skills inheritance read path. Returns the full
/// `SkillRow` shape so the frontend can render name, description, and
/// colour without a second query.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_for_role(conn: &Connection, role_id: &str) -> Result<Vec<SkillRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.description, s.color, s.position, s.created_at, s.updated_at \
         FROM role_skills rs \
         JOIN skills s ON s.id = rs.skill_id \
         WHERE rs.role_id = ?1 \
         ORDER BY rs.position ASC, s.name ASC",
    )?;
    let rows = stmt.query_map(params![role_id], SkillRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// List every skill attached to `task_id`, joined from `skills`, ordered
/// by `task_skills.position ASC`. Includes both direct (origin =
/// 'direct') and inherited rows — caller can post-filter on origin if a
/// narrower view is desired; ctq-117 surfaces the full attached set.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_for_task(conn: &Connection, task_id: &str) -> Result<Vec<SkillRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.description, s.color, s.position, s.created_at, s.updated_at \
         FROM task_skills ts \
         JOIN skills s ON s.id = ts.skill_id \
         WHERE ts.task_id = ?1 \
         ORDER BY ts.position ASC, s.name ASC",
    )?;
    let rows = stmt.query_map(params![task_id], SkillRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Attach a skill directly to a task (origin = 'direct'). Idempotent on
/// `(task_id, skill_id)`: re-insert silently no-ops via INSERT OR IGNORE
/// — re-adds do not bump position, matching prompt cascade semantics
/// (ADR-0006).
///
/// ctq-127.
///
/// # Errors
///
/// FK violation on either id surfaces as [`DbError::Sqlite`].
pub fn add_task_skill(
    conn: &Connection,
    task_id: &str,
    skill_id: &str,
    position: f64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO task_skills (task_id, skill_id, origin, position) \
         VALUES (?1, ?2, 'direct', ?3) \
         ON CONFLICT(task_id, skill_id) DO NOTHING",
        params![task_id, skill_id, position],
    )?;
    Ok(())
}

/// Detach a direct skill from a task. Inherited rows (origin
/// `role:…`, `board:…`, `column:…`) are not touched. Returns `true` if
/// a row was removed.
///
/// ctq-127.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_task_skill(
    conn: &Connection,
    task_id: &str,
    skill_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM task_skills WHERE task_id = ?1 AND skill_id = ?2 AND origin = 'direct'",
        params![task_id, skill_id],
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

    #[test]
    fn insert_then_get() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &SkillDraft {
                name: "Rust".into(),
                description: Some("Low-level systems".into()),
                color: Some("#abcdef".into()),
                position: 1.0,
            },
        )
        .unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert_eq!(got.description, Some("Low-level systems".into()));
    }

    #[test]
    fn list_ordered_by_position() {
        let conn = fresh_db();
        insert(
            &conn,
            &SkillDraft {
                name: "B".into(),
                description: None,
                color: None,
                position: 2.0,
            },
        )
        .unwrap();
        insert(
            &conn,
            &SkillDraft {
                name: "A".into(),
                description: None,
                color: None,
                position: 1.0,
            },
        )
        .unwrap();
        let list = list_all(&conn).unwrap();
        assert_eq!(list[0].name, "A");
        assert_eq!(list[1].name, "B");
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        assert!(update(&conn, "ghost", &SkillPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn update_partial_fields() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &SkillDraft {
                name: "Old".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        let updated = update(
            &conn,
            &row.id,
            &SkillPatch {
                name: Some("New".into()),
                ..SkillPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "New");
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &SkillDraft {
                name: "S".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn unique_name_violation() {
        let conn = fresh_db();
        insert(
            &conn,
            &SkillDraft {
                name: "Same".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        let err = insert(
            &conn,
            &SkillDraft {
                name: "Same".into(),
                description: None,
                color: None,
                position: 1.0,
            },
        )
        .expect_err("UNIQUE");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    /// ctq-117: list_for_role on a role with no attached skills returns
    /// an empty Vec without an error.
    #[test]
    fn list_for_role_empty() {
        let conn = fresh_db();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('r1','R1','',0,0)",
            [],
        )
        .unwrap();
        let list = list_for_role(&conn, "r1").unwrap();
        assert!(list.is_empty());
    }

    /// ctq-117: list_for_role returns attached skills ordered by
    /// `role_skills.position ASC` regardless of insertion order.
    #[test]
    fn list_for_role_ordered_by_join_position() {
        let conn = fresh_db();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('r1','R1','',0,0)",
            [],
        )
        .unwrap();
        let s_a = insert(
            &conn,
            &SkillDraft {
                name: "Alpha".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        let s_b = insert(
            &conn,
            &SkillDraft {
                name: "Bravo".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        // Insert join rows out of position-order on purpose.
        conn.execute(
            "INSERT INTO role_skills (role_id, skill_id, position) VALUES ('r1', ?1, 2.0)",
            params![s_a.id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO role_skills (role_id, skill_id, position) VALUES ('r1', ?1, 1.0)",
            params![s_b.id],
        )
        .unwrap();
        let list = list_for_role(&conn, "r1").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Bravo");
        assert_eq!(list[1].name, "Alpha");
    }

    /// ctq-127: add_task_skill is idempotent on `(task_id, skill_id)` —
    /// re-add does not duplicate the row and does not change the
    /// stored position (matching prompt cascade semantics).
    #[test]
    fn add_task_skill_idempotent_and_positioned() {
        let conn = fresh_db();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd','B','sp',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('co','bd','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd','co','sp-1','T',0,0,0);",
        )
        .unwrap();
        let s = insert(
            &conn,
            &SkillDraft {
                name: "S".into(),
                description: None,
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        add_task_skill(&conn, "t1", &s.id, 1.0).unwrap();
        // Re-add at a different position — should be a no-op.
        add_task_skill(&conn, "t1", &s.id, 999.0).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_skills WHERE task_id = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "re-add must not duplicate the join row");
        let pos: f64 = conn
            .query_row(
                "SELECT position FROM task_skills WHERE task_id = 't1' AND skill_id = ?1",
                params![s.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            (pos - 1.0).abs() < f64::EPSILON,
            "re-add must not bump position"
        );
    }

    /// ctq-127: remove_task_skill returns false when no row matches and
    /// only deletes `origin = 'direct'` rows.
    #[test]
    fn remove_task_skill_false_when_missing() {
        let conn = fresh_db();
        assert!(!remove_task_skill(&conn, "ghost", "ghost").unwrap());
    }
}
