//! Spaces repository — pure synchronous SQL.
//!
//! Reads and writes against the `spaces` table from
//! `db/migrations/001_initial.sql` (Promptery v0.4 lines 1-15) plus the
//! additive `color`/`icon` columns from migration
//! `008_space_board_icons_colors.sql`.
//!
//! Spaces are the top-level partition: every board lives inside one,
//! every task slug derives from the space's `prefix`. The `prefix`
//! column carries a CHECK constraint (`[a-z0-9-]{1,10}`) which the
//! repository surfaces as a generic `ConstraintViolation`; the
//! use-case layer maps it to `AppError::Validation`.
//!
//! Naming: [`SpaceRow`] mirrors the table 1:1; the api layer maps it to
//! `domain::Space` via a hand-written conversion in the use-case layer
//! (same approach as boards).

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `spaces` table.
#[derive(Debug, Clone, PartialEq)]
pub struct SpaceRow {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub description: Option<String>,
    /// Optional `#RRGGBB` colour (migration `008_space_board_icons_colors.sql`).
    pub color: Option<String>,
    /// Optional pixel-icon identifier (migration
    /// `008_space_board_icons_colors.sql`). The frontend maps this
    /// string onto a React component from `src/shared/ui/Icon/`.
    pub icon: Option<String>,
    pub is_default: bool,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SpaceRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let is_default: i64 = row.get("is_default")?;
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            prefix: row.get("prefix")?,
            description: row.get("description")?,
            color: row.get("color")?,
            icon: row.get("icon")?,
            is_default: is_default != 0,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new space. The repository fills `id`,
/// `created_at`, `updated_at`. `position` defaults to 0.0 and
/// `is_default` defaults to `false` when omitted.
#[derive(Debug, Clone)]
pub struct SpaceDraft {
    pub name: String,
    pub prefix: String,
    pub description: Option<String>,
    /// Optional `#RRGGBB` colour. `None` stores SQL NULL.
    pub color: Option<String>,
    /// Pixel-icon identifier. `None` stores SQL NULL.
    pub icon: Option<String>,
    pub is_default: bool,
    pub position: Option<f64>,
}

/// Partial update payload — every field is optional; `None` keeps the
/// stored value. Nullable fields use `Option<Option<String>>`: the
/// outer `None` means "skip this field"; `Some(None)` means "clear to
/// NULL"; `Some(Some(v))` means "set to `v`". The repository always
/// bumps `updated_at` regardless of which fields changed.
#[derive(Debug, Clone, Default)]
pub struct SpacePatch {
    pub name: Option<String>,
    pub description: Option<Option<String>>, // None = keep, Some(None) = NULL
    /// `None` = leave alone; `Some(None)` = clear; `Some(Some(s))` = set.
    pub color: Option<Option<String>>,
    /// `None` = leave alone; `Some(None)` = clear; `Some(Some(s))` = set.
    pub icon: Option<Option<String>>,
    pub is_default: Option<bool>,
    pub position: Option<f64>,
}

/// `SELECT … FROM spaces ORDER BY position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces any rusqlite error from `prepare` / `query_map`.
pub fn list_all(conn: &Connection) -> Result<Vec<SpaceRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, prefix, description, color, icon, is_default, position, \
                created_at, updated_at \
         FROM spaces \
         ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], SpaceRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup by primary key. `Ok(None)` if the row doesn't exist.
///
/// # Errors
///
/// Surfaces non-`QueryReturnedNoRows` rusqlite errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<SpaceRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, prefix, description, color, icon, is_default, position, \
                created_at, updated_at \
         FROM spaces WHERE id = ?1",
    )?;
    Ok(stmt.query_row(params![id], SpaceRow::from_row).optional()?)
}

/// Insert one space. Generates id via `nanoid`, stamps timestamps from
/// `now_millis()`. The schema enforces UNIQUE(`prefix`) and the CHECK
/// `prefix GLOB '[a-z0-9-]*' AND length BETWEEN 1 AND 10` — both surface
/// as `SQLITE_CONSTRAINT` errors that the use case maps appropriately.
///
/// # Errors
///
/// Bubbles up rusqlite errors (constraint violations, etc.) as
/// [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &SpaceDraft) -> Result<SpaceRow, DbError> {
    let id = new_id();
    let now = now_millis();
    let position = draft.position.unwrap_or(0.0);
    let is_default = i64::from(draft.is_default);

    conn.execute(
        "INSERT INTO spaces \
            (id, name, prefix, description, color, icon, is_default, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            draft.name,
            draft.prefix,
            draft.description,
            draft.color,
            draft.icon,
            is_default,
            position,
            now
        ],
    )?;

    Ok(SpaceRow {
        id,
        name: draft.name.clone(),
        prefix: draft.prefix.clone(),
        description: draft.description.clone(),
        color: draft.color.clone(),
        icon: draft.icon.clone(),
        is_default: draft.is_default,
        position,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Bumps `updated_at` regardless. Returns the row after
/// the update, or `Ok(None)` if no row had the requested id.
///
/// `description`, `color`, and `icon` are nullable — they appear in
/// the SQL only when the patch carries an explicit `Some(_)`:
/// `Some(None)` clears the column, `Some(Some(s))` sets it. The
/// non-nullable scalar fields use `COALESCE(?, current)`.
///
/// # Errors
///
/// Constraint violations on `prefix` (UNIQUE, CHECK) bubble up as
/// [`DbError::Sqlite`]; the use-case layer translates them to
/// `AppError::Conflict` / `AppError::Validation`.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &SpacePatch,
) -> Result<Option<SpaceRow>, DbError> {
    use std::fmt::Write as _;
    let now = now_millis();
    let is_default_param: Option<i64> = patch.is_default.map(i64::from);

    let mut sql = String::from(
        "UPDATE spaces SET name = COALESCE(?1, name), \
         is_default = COALESCE(?2, is_default), \
         position = COALESCE(?3, position)",
    );
    let mut next_param = 4_usize;
    let mut params_vec: Vec<rusqlite::types::Value> = vec![
        patch.name.clone().into(),
        is_default_param.into(),
        patch.position.into(),
    ];
    if let Some(d) = patch.description.as_ref() {
        let _ = write!(sql, ", description = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(d.clone()));
        next_param += 1;
    }
    if let Some(c) = patch.color.as_ref() {
        let _ = write!(sql, ", color = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(c.clone()));
        next_param += 1;
    }
    if let Some(i) = patch.icon.as_ref() {
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
    get_by_id(conn, id)
}

/// Delete by id. Returns `true` if a row was actually removed.
///
/// FK semantics: `boards.space_id` has no `ON DELETE` clause (NOT NULL
/// REFERENCES spaces), so deleting a non-empty space fails with
/// `SQLITE_CONSTRAINT_FOREIGNKEY`. The use case maps that to
/// `AppError::Conflict`. `space_counters` cascades automatically.
///
/// # Errors
///
/// Surfaces rusqlite errors. FK violation bubbles up unchanged.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM spaces WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn draft(prefix: &str) -> SpaceDraft {
        SpaceDraft {
            name: format!("Space {prefix}"),
            prefix: prefix.into(),
            description: None,
            color: None,
            icon: None,
            is_default: false,
            position: Some(0.0),
        }
    }

    #[test]
    fn insert_then_get_returns_same_row() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("abc")).unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
    }

    #[test]
    fn list_all_orders_by_position_then_name() {
        let conn = fresh_db();
        insert(
            &conn,
            &SpaceDraft {
                name: "Beta".into(),
                prefix: "bb".into(),
                description: None,
                color: None,
                icon: None,
                is_default: false,
                position: Some(2.0),
            },
        )
        .unwrap();
        insert(
            &conn,
            &SpaceDraft {
                name: "Alpha".into(),
                prefix: "aa".into(),
                description: None,
                color: None,
                icon: None,
                is_default: false,
                position: Some(2.0),
            },
        )
        .unwrap();
        insert(
            &conn,
            &SpaceDraft {
                name: "Zeta".into(),
                prefix: "zz".into(),
                description: None,
                color: None,
                icon: None,
                is_default: false,
                position: Some(1.0),
            },
        )
        .unwrap();
        let rows = list_all(&conn).unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["Zeta", "Alpha", "Beta"]);
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("abc")).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &SpacePatch {
                name: Some("Renamed".into()),
                description: Some(Some("New desc".into())),
                ..SpacePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.description.as_deref(), Some("New desc"));
        assert_eq!(updated.prefix, "abc"); // unchanged
        assert!(updated.updated_at >= row.created_at);
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        let res = update(&conn, "ghost", &SpacePatch::default()).unwrap();
        assert!(res.is_none());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("abc")).unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
        assert!(get_by_id(&conn, &row.id).unwrap().is_none());
    }

    #[test]
    fn unique_prefix_violation_is_constraint_error() {
        let conn = fresh_db();
        insert(&conn, &draft("abc")).unwrap();
        let err = insert(&conn, &draft("abc")).expect_err("unique violation");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected ConstraintViolation, got {other:?}"),
        }
    }

    // ------------------------------------------------------------------
    // Icon + colour round-trip — mirror of the prompt_groups coverage.
    // ------------------------------------------------------------------

    #[test]
    fn insert_with_icon_and_color_round_trips() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &SpaceDraft {
                name: "Iconic".into(),
                prefix: "ico".into(),
                description: None,
                color: Some("#abcdef".into()),
                icon: Some("star".into()),
                is_default: false,
                position: Some(0.0),
            },
        )
        .unwrap();
        assert_eq!(row.color.as_deref(), Some("#abcdef"));
        assert_eq!(row.icon.as_deref(), Some("star"));
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(got.color.as_deref(), Some("#abcdef"));
        assert_eq!(got.icon.as_deref(), Some("star"));
    }

    #[test]
    fn update_can_set_clear_and_change_icon() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("abc")).unwrap();
        assert_eq!(row.icon, None);

        // Set.
        let after_set = update(
            &conn,
            &row.id,
            &SpacePatch {
                icon: Some(Some("bolt".into())),
                ..SpacePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_set.icon.as_deref(), Some("bolt"));

        // Change.
        let after_change = update(
            &conn,
            &row.id,
            &SpacePatch {
                icon: Some(Some("heart".into())),
                ..SpacePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_change.icon.as_deref(), Some("heart"));

        // Clear.
        let after_clear = update(
            &conn,
            &row.id,
            &SpacePatch {
                icon: Some(None),
                ..SpacePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_clear.icon, None);
    }

    #[test]
    fn update_leaves_icon_untouched_when_patch_skips_it() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &SpaceDraft {
                name: "S".into(),
                prefix: "s".into(),
                description: None,
                color: None,
                icon: Some("star".into()),
                is_default: false,
                position: Some(0.0),
            },
        )
        .unwrap();
        // Update only `name`. Icon must survive.
        let updated = update(
            &conn,
            &row.id,
            &SpacePatch {
                name: Some("Renamed".into()),
                ..SpacePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.icon.as_deref(), Some("star"));
        assert_eq!(updated.name, "Renamed");
    }

    #[test]
    fn update_can_clear_color() {
        let conn = fresh_db();
        let row = insert(
            &conn,
            &SpaceDraft {
                name: "S".into(),
                prefix: "s".into(),
                description: None,
                color: Some("#112233".into()),
                icon: None,
                is_default: false,
                position: Some(0.0),
            },
        )
        .unwrap();
        let cleared = update(
            &conn,
            &row.id,
            &SpacePatch {
                color: Some(None),
                ..SpacePatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(cleared.color, None);
    }
}
