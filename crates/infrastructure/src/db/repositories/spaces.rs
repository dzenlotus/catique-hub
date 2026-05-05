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
    /// Phase 5 workflow-graph payload (ctq-113 / migration
    /// `015_space_workflow_graph.sql`). Stored verbatim as TEXT — no
    /// shape validation at this layer; the future editor owns the
    /// schema. `None` represents an unset graph (the default for every
    /// existing row post-migration).
    pub workflow_graph_json: Option<String>,
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
            workflow_graph_json: row.get("workflow_graph_json")?,
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
                created_at, updated_at, workflow_graph_json \
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
                created_at, updated_at, workflow_graph_json \
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
        // `workflow_graph_json` defaults to NULL on a fresh insert
        // (migration 015). Setting it requires the dedicated
        // `set_workflow_graph` helper — keeps the create path lean.
        workflow_graph_json: None,
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

// ---------------------------------------------------------------------
// Phase 5 workflow-graph stub (ctq-113 / migration 015_space_workflow_graph.sql).
//
// The column itself is opaque TEXT — no JSON validation here. The
// follow-up Phase 5 editor task owns shape + migration of the payload;
// this layer round-trips arbitrary strings unchanged.
// ---------------------------------------------------------------------

/// Read the raw workflow-graph payload for `space_id`. `Ok(None)` for an
/// unset slot (the post-migration default for every existing row);
/// `Ok(None)` *also* surfaces when the space id is unknown — the IPC
/// layer treats both as "no graph configured" because the contract only
/// promises a string-or-absent shape.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_workflow_graph(
    conn: &Connection,
    space_id: &str,
) -> Result<Option<String>, DbError> {
    let mut stmt = conn.prepare("SELECT workflow_graph_json FROM spaces WHERE id = ?1")?;
    let row = stmt
        .query_row(params![space_id], |r| r.get::<_, Option<String>>(0))
        .optional()?;
    // Outer `Option` = "row exists?"; inner `Option` = "column non-NULL?".
    // Collapse both into a single Option<String> — the IPC contract does
    // not distinguish "missing space" from "unset slot".
    Ok(row.flatten())
}

/// Write `json` verbatim into `space_id.workflow_graph_json`. Bumps
/// `updated_at`. Returns `true` if a row matched (the space exists).
///
/// **No JSON validation.** ctq-113 is a Phase 5 stub: the editor owns
/// payload shape; the backend stores whatever string it receives. The
/// follow-up validation task should layer a parse step at the IPC
/// boundary if desired.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn set_workflow_graph(
    conn: &Connection,
    space_id: &str,
    json: &str,
) -> Result<bool, DbError> {
    let now = now_millis();
    let n = conn.execute(
        "UPDATE spaces SET workflow_graph_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![json, now, space_id],
    )?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------
// Join-table helpers — `space_prompts` (migration 011_space_prompts.sql).
//
// The fourth inheritance level (D9 / ctq-73). Mirrors the
// `board_prompts` / `column_prompts` shape but exposes a `Vec<PromptRow>`
// reader (joined onto `prompts`) so the API layer can return the full
// prompt payload rather than just opaque ids — same pattern as
// `tasks::list_task_prompts`.
// ---------------------------------------------------------------------

/// List every prompt attached to a space, joined from `prompts`,
/// ordered by `space_prompts.position` ascending.
///
/// Returns an empty Vec when the space has no attached prompts; we do
/// **not** validate that `space_id` actually exists here — the use-case
/// layer handles that check when it matters.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_space_prompts(
    conn: &Connection,
    space_id: &str,
) -> Result<Vec<super::prompts::PromptRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.content, p.color, p.short_description, p.icon, \
                p.examples_json, p.token_count, p.created_at, p.updated_at \
         FROM space_prompts sp \
         JOIN prompts p ON p.id = sp.prompt_id \
         WHERE sp.space_id = ?1 \
         ORDER BY sp.position ASC",
    )?;
    let rows = stmt.query_map(params![space_id], super::prompts::PromptRow::from_row_pub)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Attach a prompt to a space. Upserts `position` if the pair already
/// exists, so callers can re-use this helper for ordering without a
/// separate "move" path.
///
/// `position` defaults to 0.0 when omitted — keeps the API signature
/// terse for the simple "append" case while still allowing the resolver
/// or DnD-reorder paths to thread an explicit fractional value through.
///
/// # Errors
///
/// FK violation (unknown `space_id` or `prompt_id`) surfaces as
/// [`DbError::Sqlite`].
pub fn add_space_prompt(
    conn: &Connection,
    space_id: &str,
    prompt_id: &str,
    position: Option<f64>,
) -> Result<(), DbError> {
    let pos = position.unwrap_or(0.0);
    conn.execute(
        "INSERT INTO space_prompts (space_id, prompt_id, position) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(space_id, prompt_id) DO UPDATE SET position = excluded.position",
        params![space_id, prompt_id, pos],
    )?;
    Ok(())
}

/// Detach a prompt from a space. Returns `true` if a row was deleted.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn remove_space_prompt(
    conn: &Connection,
    space_id: &str,
    prompt_id: &str,
) -> Result<bool, DbError> {
    let n = conn.execute(
        "DELETE FROM space_prompts WHERE space_id = ?1 AND prompt_id = ?2",
        params![space_id, prompt_id],
    )?;
    Ok(n > 0)
}

/// Atomically replace the full ordered prompt list for a space.
///
/// Deletes every existing row for `space_id`, then re-inserts
/// `ordered_prompt_ids` with `position = 1.0..=N.0`. Wrapped in a
/// `SAVEPOINT` so the operation is atomic even when the caller passes
/// a connection that is not already inside a transaction — same shape
/// as `prompt_groups::set_members`.
///
/// `ordered_prompt_ids` may be empty: that clears the space's prompt
/// attachments in one round-trip.
///
/// # Errors
///
/// FK violation (unknown `space_id` or any `prompt_id`) rolls the
/// savepoint back and surfaces as [`DbError::Sqlite`].
pub fn set_space_prompts(
    conn: &Connection,
    space_id: &str,
    ordered_prompt_ids: &[String],
) -> Result<(), DbError> {
    conn.execute("SAVEPOINT set_space_prompts", [])?;
    let result = (|| -> Result<(), DbError> {
        conn.execute(
            "DELETE FROM space_prompts WHERE space_id = ?1",
            params![space_id],
        )?;
        for (idx, prompt_id) in ordered_prompt_ids.iter().enumerate() {
            // Position is REAL — start at 1.0 and spread integer
            // positions on the natural-number lattice so DnD reorder
            // paths can mid-point insert without renumbering.
            #[allow(clippy::cast_precision_loss)]
            let position = (idx + 1) as f64;
            conn.execute(
                "INSERT INTO space_prompts (space_id, prompt_id, position) \
                 VALUES (?1, ?2, ?3)",
                params![space_id, prompt_id, position],
            )?;
        }
        Ok(())
    })();
    if result.is_ok() {
        conn.execute("RELEASE set_space_prompts", [])?;
    } else {
        conn.execute("ROLLBACK TO set_space_prompts", [])?;
        conn.execute("RELEASE set_space_prompts", [])?;
    }
    result
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

    // ------------------------------------------------------------------
    // space_prompts join (migration 011_space_prompts.sql).
    // ------------------------------------------------------------------

    /// Insert a prompt row directly so FK constraints on `space_prompts`
    /// are satisfied without dragging the prompts use-case in.
    fn insert_prompt(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES (?1, ?2, '', 0, 0)",
            params![id, id],
        )
        .unwrap();
    }

    #[test]
    fn space_prompts_table_exists_after_migrations() {
        // Migration 011 must land the table in the embedded set.
        let conn = fresh_db();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type='table' AND name='space_prompts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "space_prompts table must exist after migrations");
    }

    #[test]
    fn add_then_list_returns_prompt_in_position_order() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        insert_prompt(&conn, "p1");
        insert_prompt(&conn, "p2");
        insert_prompt(&conn, "p3");

        // Insert out of order to prove ORDER BY position works.
        add_space_prompt(&conn, &space.id, "p2", Some(2.0)).unwrap();
        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();
        add_space_prompt(&conn, &space.id, "p3", Some(3.0)).unwrap();

        let prompts = list_space_prompts(&conn, &space.id).unwrap();
        let ids: Vec<&str> = prompts.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["p1", "p2", "p3"]);
    }

    #[test]
    fn add_is_idempotent_and_updates_position() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        insert_prompt(&conn, "p1");

        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();
        add_space_prompt(&conn, &space.id, "p1", Some(5.0)).unwrap();

        // Still exactly one row; position bumped to 5.0.
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM space_prompts WHERE space_id = ?1",
                params![space.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
        let pos: f64 = conn
            .query_row(
                "SELECT position FROM space_prompts WHERE space_id = ?1 AND prompt_id = 'p1'",
                params![space.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!((pos - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn remove_returns_true_then_false() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        insert_prompt(&conn, "p1");
        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();

        assert!(remove_space_prompt(&conn, &space.id, "p1").unwrap());
        assert!(!remove_space_prompt(&conn, &space.id, "p1").unwrap());
        assert!(list_space_prompts(&conn, &space.id).unwrap().is_empty());
    }

    #[test]
    fn round_trip_create_attach_three_remove_one() {
        // DoD round-trip: 3 attached → list returns 3 in position
        // order → remove 1 → list returns 2.
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        for id in ["p1", "p2", "p3"] {
            insert_prompt(&conn, id);
        }
        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();
        add_space_prompt(&conn, &space.id, "p2", Some(2.0)).unwrap();
        add_space_prompt(&conn, &space.id, "p3", Some(3.0)).unwrap();

        let listed: Vec<String> = list_space_prompts(&conn, &space.id)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(listed, vec!["p1", "p2", "p3"]);

        assert!(remove_space_prompt(&conn, &space.id, "p2").unwrap());
        let after: Vec<String> = list_space_prompts(&conn, &space.id)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(after, vec!["p1", "p3"]);
    }

    #[test]
    fn set_space_prompts_replaces_all() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        for id in ["p1", "p2", "p3"] {
            insert_prompt(&conn, id);
        }
        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();
        add_space_prompt(&conn, &space.id, "p2", Some(2.0)).unwrap();

        // Replace with an entirely different ordered set.
        set_space_prompts(&conn, &space.id, &["p3".into(), "p1".into()]).unwrap();

        let listed: Vec<String> = list_space_prompts(&conn, &space.id)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(listed, vec!["p3", "p1"]);
    }

    #[test]
    fn set_space_prompts_with_empty_clears_all() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        insert_prompt(&conn, "p1");
        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();

        set_space_prompts(&conn, &space.id, &[]).unwrap();
        assert!(list_space_prompts(&conn, &space.id).unwrap().is_empty());
    }

    #[test]
    fn set_space_prompts_rolls_back_on_bad_fk() {
        // Bad FK in the tail of the list must roll the savepoint back —
        // the pre-existing row stays, no partial replacement.
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        insert_prompt(&conn, "p1");
        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();

        let err = set_space_prompts(&conn, &space.id, &["p1".into(), "ghost".into()])
            .expect_err("FK violation expected");
        match err {
            DbError::Sqlite(_) => {}
            other => panic!("expected Sqlite FK error, got {other:?}"),
        }

        // Pre-existing row survived the rollback.
        let listed: Vec<String> = list_space_prompts(&conn, &space.id)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(listed, vec!["p1"]);
    }

    #[test]
    fn space_delete_cascades_to_space_prompts() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        insert_prompt(&conn, "p1");
        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();

        // Remove via raw DELETE — the cascade is a property of the FK
        // declaration, independent of the use-case layer.
        conn.execute("DELETE FROM spaces WHERE id = ?1", params![space.id])
            .unwrap();

        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM space_prompts WHERE space_id = ?1",
                params![space.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0, "FK cascade must strip space_prompts on space delete");
    }

    #[test]
    fn prompt_delete_cascades_to_space_prompts() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        insert_prompt(&conn, "p1");
        add_space_prompt(&conn, &space.id, "p1", Some(1.0)).unwrap();

        conn.execute("DELETE FROM prompts WHERE id = 'p1'", [])
            .unwrap();

        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM space_prompts WHERE space_id = ?1",
                params![space.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0, "FK cascade must strip space_prompts on prompt delete");
    }

    // ------------------------------------------------------------------
    // Phase 5 workflow-graph stub (ctq-113 / migration 015).
    // ------------------------------------------------------------------

    #[test]
    fn fresh_space_has_null_workflow_graph() {
        let conn = fresh_db();
        let row = insert(&conn, &draft("abc")).unwrap();
        assert_eq!(row.workflow_graph_json, None);
        let got = get_workflow_graph(&conn, &row.id).unwrap();
        assert_eq!(got, None);
    }

    #[test]
    fn workflow_graph_round_trips_arbitrary_json_string() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        let payload = r#"{"nodes":[{"id":"a"}],"edges":[]}"#;
        let updated = set_workflow_graph(&conn, &space.id, payload).unwrap();
        assert!(updated, "set must report a row matched");
        let got = get_workflow_graph(&conn, &space.id).unwrap();
        assert_eq!(got.as_deref(), Some(payload));
    }

    #[test]
    fn workflow_graph_accepts_non_json_garbage_no_validation() {
        // ctq-113 is a stub — payload shape is the editor's problem.
        // We must not reject "garbage" at the storage layer.
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        let updated = set_workflow_graph(&conn, &space.id, "not-json{").unwrap();
        assert!(updated);
        assert_eq!(
            get_workflow_graph(&conn, &space.id).unwrap().as_deref(),
            Some("not-json{")
        );
    }

    #[test]
    fn set_workflow_graph_returns_false_for_missing_space() {
        let conn = fresh_db();
        let updated = set_workflow_graph(&conn, "ghost", "{}").unwrap();
        assert!(!updated, "no row matched ghost id");
    }

    #[test]
    fn get_workflow_graph_returns_none_for_missing_space() {
        let conn = fresh_db();
        assert!(get_workflow_graph(&conn, "ghost").unwrap().is_none());
    }

    #[test]
    fn workflow_graph_overwrite_keeps_latest_payload() {
        let conn = fresh_db();
        let space = insert(&conn, &draft("abc")).unwrap();
        set_workflow_graph(&conn, &space.id, "{\"v\":1}").unwrap();
        set_workflow_graph(&conn, &space.id, "{\"v\":2}").unwrap();
        assert_eq!(
            get_workflow_graph(&conn, &space.id).unwrap().as_deref(),
            Some("{\"v\":2}")
        );
    }
}
