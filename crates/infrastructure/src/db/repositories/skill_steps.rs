//! Skill-steps repository — `skill_steps` metadata.
//!
//! Schema: `027_skill_steps.sql`. SKILL-V2-A.
//!
//! Mirrors the `skill_attachments` repo shape — typed `Draft` + `Patch`
//! payloads, returns the persisted row on insert / update so the
//! use-case layer does not have to round-trip a follow-up `get_by_id`.
//!
//! `replace_all` is intentionally on this layer (not the use case)
//! because the wipe + insert dance lives inside a single SQLite
//! transaction — the use case calls it once and trusts the atomic
//! contract.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of `skill_steps`.
#[derive(Debug, Clone, PartialEq)]
pub struct SkillStepRow {
    pub id: String,
    pub skill_id: String,
    pub position: f64,
    pub title: String,
    pub body: String,
    pub expected_outcome: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SkillStepRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            skill_id: row.get("skill_id")?,
            position: row.get("position")?,
            title: row.get("title")?,
            body: row.get("body")?,
            expected_outcome: row.get("expected_outcome")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new step. `created_at` / `updated_at` are
/// stamped by the repository.
#[derive(Debug, Clone)]
pub struct SkillStepDraft {
    pub skill_id: String,
    pub position: f64,
    pub title: String,
    pub body: String,
    pub expected_outcome: Option<String>,
}

/// Partial-update payload. `None` means "do not change". For
/// nullable `expected_outcome`, `Some(None)` means "clear to NULL".
#[derive(Debug, Clone, Default)]
pub struct SkillStepPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub expected_outcome: Option<Option<String>>,
    pub position: Option<f64>,
}

/// List every step for a skill, ordered by `position ASC, id ASC` so
/// tied positions stay deterministic across calls.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_by_skill(conn: &Connection, skill_id: &str) -> Result<Vec<SkillStepRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, skill_id, position, title, body, expected_outcome, created_at, updated_at \
         FROM skill_steps WHERE skill_id = ?1 \
         ORDER BY position ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![skill_id], SkillStepRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<SkillStepRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, skill_id, position, title, body, expected_outcome, created_at, updated_at \
         FROM skill_steps WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], SkillStepRow::from_row)
        .optional()?)
}

/// Insert one step. Mints id, stamps `created_at` and `updated_at`.
///
/// # Errors
///
/// FK violation on `skill_id` surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &SkillStepDraft) -> Result<SkillStepRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO skill_steps \
            (id, skill_id, position, title, body, expected_outcome, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            draft.skill_id,
            draft.position,
            draft.title,
            draft.body,
            draft.expected_outcome,
            now,
        ],
    )?;
    Ok(SkillStepRow {
        id,
        skill_id: draft.skill_id.clone(),
        position: draft.position,
        title: draft.title.clone(),
        body: draft.body.clone(),
        expected_outcome: draft.expected_outcome.clone(),
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Always bumps `updated_at`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &SkillStepPatch,
) -> Result<Option<SkillStepRow>, DbError> {
    let now = now_millis();
    let mut clause_parts: Vec<&'static str> = Vec::new();

    if patch.title.is_some() {
        clause_parts.push("title = COALESCE(?2, title)");
    }
    if patch.body.is_some() {
        clause_parts.push("body = COALESCE(?3, body)");
    }
    if patch.expected_outcome.is_some() {
        clause_parts.push("expected_outcome = ?4");
    }
    if patch.position.is_some() {
        clause_parts.push("position = COALESCE(?5, position)");
    }

    let set_clause = if clause_parts.is_empty() {
        "updated_at = ?1".to_owned()
    } else {
        let mut all = clause_parts;
        all.push("updated_at = ?1");
        all.join(", ")
    };
    let sql = format!("UPDATE skill_steps SET {set_clause} WHERE id = ?6");
    let outcome_val: Option<String> = patch.expected_outcome.as_ref().and_then(Clone::clone);

    let updated = conn.execute(
        &sql,
        params![
            now,
            patch.title,
            patch.body,
            outcome_val,
            patch.position,
            id
        ],
    )?;
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one step by id. Returns `true` when a row was removed.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM skill_steps WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

/// Atomically replace every step for `skill_id` with the supplied
/// drafts. The caller wraps this in a `BEGIN IMMEDIATE` transaction
/// from the use-case layer; the repo runs the wipe + insert sequence
/// inside that transaction so the row set is swapped in one shot
/// (no observer ever sees an empty step list for an existing skill
/// mid-import).
///
/// Returns the freshly-minted rows in the order they were inserted.
///
/// # Errors
///
/// Surfaces rusqlite errors from either the DELETE or the INSERT.
pub fn replace_all(
    conn: &Connection,
    skill_id: &str,
    drafts: &[SkillStepDraft],
) -> Result<Vec<SkillStepRow>, DbError> {
    conn.execute(
        "DELETE FROM skill_steps WHERE skill_id = ?1",
        params![skill_id],
    )?;
    let mut out = Vec::with_capacity(drafts.len());
    for draft in drafts {
        let row = insert(conn, draft)?;
        out.push(row);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db_with_skill() -> (Connection, String) {
        let mut conn = Connection::open_in_memory().expect("open in-memory");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("pragma");
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO skills (id, name, description, color, position, created_at, updated_at) \
                 VALUES ('sk1','Rust',NULL,NULL,0,0,0);",
        )
        .expect("seed skill");
        (conn, "sk1".to_owned())
    }

    #[test]
    fn insert_then_get() {
        let (conn, sk) = fresh_db_with_skill();
        let row = insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk.clone(),
                position: 1.0,
                title: "First".into(),
                body: "Do thing".into(),
                expected_outcome: Some("Thing done".into()),
            },
        )
        .expect("insert");
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert_eq!(got.skill_id, sk);
        assert_eq!(got.expected_outcome.as_deref(), Some("Thing done"));
    }

    #[test]
    fn list_ordered_by_position_then_id() {
        let (conn, sk) = fresh_db_with_skill();
        let _a = insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk.clone(),
                position: 2.0,
                title: "Second".into(),
                body: String::new(),
                expected_outcome: None,
            },
        )
        .unwrap();
        let _b = insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk.clone(),
                position: 1.0,
                title: "First".into(),
                body: String::new(),
                expected_outcome: None,
            },
        )
        .unwrap();
        let list = list_by_skill(&conn, &sk).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "First");
        assert_eq!(list[1].title, "Second");
    }

    #[test]
    fn update_partial_fields_and_clear_outcome() {
        let (conn, sk) = fresh_db_with_skill();
        let row = insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk,
                position: 1.0,
                title: "Old".into(),
                body: "body".into(),
                expected_outcome: Some("out".into()),
            },
        )
        .unwrap();
        let updated = update(
            &conn,
            &row.id,
            &SkillStepPatch {
                title: Some("New".into()),
                expected_outcome: Some(None),
                ..SkillStepPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.title, "New");
        assert_eq!(updated.body, "body");
        assert!(updated.expected_outcome.is_none());
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let (conn, _) = fresh_db_with_skill();
        assert!(update(&conn, "ghost", &SkillStepPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let (conn, sk) = fresh_db_with_skill();
        let row = insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk,
                position: 0.0,
                title: "T".into(),
                body: String::new(),
                expected_outcome: None,
            },
        )
        .unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn cascade_delete_with_skill() {
        let (conn, sk) = fresh_db_with_skill();
        insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk.clone(),
                position: 0.0,
                title: "A".into(),
                body: String::new(),
                expected_outcome: None,
            },
        )
        .unwrap();
        insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk.clone(),
                position: 1.0,
                title: "B".into(),
                body: String::new(),
                expected_outcome: None,
            },
        )
        .unwrap();
        assert_eq!(list_by_skill(&conn, &sk).unwrap().len(), 2);
        conn.execute("DELETE FROM skills WHERE id = ?1", params![sk])
            .unwrap();
        assert!(list_by_skill(&conn, &sk).unwrap().is_empty());
    }

    #[test]
    fn replace_all_wipes_and_reinserts_atomically() {
        let (mut conn, sk) = fresh_db_with_skill();
        // Seed two pre-existing rows we expect to be wiped.
        insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk.clone(),
                position: 1.0,
                title: "Old1".into(),
                body: String::new(),
                expected_outcome: None,
            },
        )
        .unwrap();
        insert(
            &conn,
            &SkillStepDraft {
                skill_id: sk.clone(),
                position: 2.0,
                title: "Old2".into(),
                body: String::new(),
                expected_outcome: None,
            },
        )
        .unwrap();

        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        let inserted = replace_all(
            &tx,
            &sk,
            &[
                SkillStepDraft {
                    skill_id: sk.clone(),
                    position: 10.0,
                    title: "New1".into(),
                    body: "b1".into(),
                    expected_outcome: Some("ok".into()),
                },
                SkillStepDraft {
                    skill_id: sk.clone(),
                    position: 20.0,
                    title: "New2".into(),
                    body: "b2".into(),
                    expected_outcome: None,
                },
            ],
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(inserted.len(), 2);

        let list = list_by_skill(&conn, &sk).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "New1");
        assert_eq!(list[1].title, "New2");
        assert!(list.iter().all(|r| !r.title.starts_with("Old")));
    }
}
