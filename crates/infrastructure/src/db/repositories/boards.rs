//! Boards repository — pure synchronous SQL.
//!
//! Reads and writes against the `boards` table from
//! `db/migrations/001_initial.sql` (Promptery v0.4 lines 22-33), plus
//! `description` (migration `003_board_description.sql`),
//! `owner_role_id` (migration `004_cat_as_agent_phase1.sql`), and the
//! optional `color` / `icon` columns from migration
//! `008_space_board_icons_colors.sql`.
//!
//! Naming convention: this module exposes a [`BoardRow`] that mirrors
//! the table's columns 1:1 (`snake_case`, with `created_at`/`updated_at`
//! as i64 epoch-ms). The api layer maps `BoardRow` → `domain::Board`
//! via a `From` impl; that keeps the row representation an
//! infrastructure detail that we can change without touching the IPC
//! contract.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `boards` table.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardRow {
    pub id: String,
    pub name: String,
    pub space_id: String,
    pub role_id: Option<String>,
    pub position: f64,
    pub description: Option<String>,
    /// Optional `#RRGGBB` colour (migration `008_space_board_icons_colors.sql`).
    pub color: Option<String>,
    /// Optional pixel-icon identifier (migration
    /// `008_space_board_icons_colors.sql`). The frontend maps this
    /// string onto a React component from `src/shared/ui/Icon/`.
    pub icon: Option<String>,
    /// `true` for the auto-created default board (migration
    /// `009_default_boards.sql`). Stored as `INTEGER` 0/1 — converted
    /// here on read. Immutable after insert: there is no `update` path
    /// that touches this column, the use-case layer refuses delete on
    /// it, and the only legitimate setter is the space-creation flow.
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// Owning cat. NOT NULL at the schema level — see migration
    /// `004_cat_as_agent_phase1.sql`. Inserts that omit this fall back
    /// to the deterministic `maintainer-system` row in the use-case
    /// layer (`BoardsUseCase::create`); the repository requires the
    /// caller to supply a value via [`BoardDraft::owner_role_id`].
    pub owner_role_id: String,
}

impl BoardRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            space_id: row.get("space_id")?,
            role_id: row.get("role_id")?,
            position: row.get("position")?,
            description: row.get("description")?,
            color: row.get("color")?,
            icon: row.get("icon")?,
            is_default: row.get::<_, i64>("is_default")? != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            owner_role_id: row.get("owner_role_id")?,
        })
    }
}

/// Draft for inserting a new board. The repository fills in `id`,
/// `created_at`, `updated_at`, and the default `position` if the caller
/// passes `None`. Slug auto-generation lives elsewhere — Promptery
/// derives it from `space_counters`, which we'll wire in E2.4.
#[derive(Debug, Clone)]
pub struct BoardDraft {
    pub name: String,
    pub space_id: String,
    pub role_id: Option<String>,
    pub position: Option<f64>,
    pub description: Option<String>,
    /// Optional `#RRGGBB` colour. `None` stores SQL NULL.
    pub color: Option<String>,
    /// Pixel-icon identifier. `None` stores SQL NULL.
    pub icon: Option<String>,
    /// `true` flags the auto-created default board for a new space
    /// (migration `009_default_boards.sql`). Set on insert only — the
    /// patch path deliberately does not expose a setter, mirroring how
    /// `roles.is_system` is treated as immutable provenance.
    pub is_default: bool,
    /// Owning cat — required by the schema (Cat-as-Agent Phase 1,
    /// ctq-73). `None` resolves to the deterministic
    /// `"maintainer-system"` row that migration
    /// `004_cat_as_agent_phase1.sql` seeds; this matches memo Q1 option
    /// (c) — auto-assign at the data layer, surface a review modal at
    /// the UI layer.
    pub owner_role_id: Option<String>,
}

/// `SELECT … FROM boards ORDER BY position ASC, name ASC`.
///
/// # Errors
///
/// Surfaces any rusqlite error from `prepare` / `query_map`.
pub fn list_all(conn: &Connection) -> Result<Vec<BoardRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, space_id, role_id, position, description, color, icon, \
                is_default, created_at, updated_at, owner_role_id \
         FROM boards \
         ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map([], BoardRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// `SELECT … FROM boards WHERE space_id = ?1 ORDER BY position, name`.
/// Used by the space-creation flow's smoke-test to confirm the default
/// board landed in the new space's row-set.
///
/// # Errors
///
/// Surfaces any rusqlite error from `prepare` / `query_map`.
pub fn list_by_space(conn: &Connection, space_id: &str) -> Result<Vec<BoardRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, space_id, role_id, position, description, color, icon, \
                is_default, created_at, updated_at, owner_role_id \
         FROM boards \
         WHERE space_id = ?1 \
         ORDER BY position ASC, name ASC",
    )?;
    let rows = stmt.query_map(params![space_id], BoardRow::from_row)?;
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
/// Surfaces any non-`QueryReturnedNoRows` rusqlite error.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<BoardRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, space_id, role_id, position, description, color, icon, \
                is_default, created_at, updated_at, owner_role_id \
         FROM boards \
         WHERE id = ?1",
    )?;
    Ok(stmt.query_row(params![id], BoardRow::from_row).optional()?)
}

/// Partial-update payload for [`update`] — every field is optional;
/// `None` keeps the stored value. Nullable fields use
/// `Option<Option<…>>` so the caller can distinguish "skip this field"
/// (outer None) from "clear to NULL" (Some(None)) and "set to value"
/// (Some(Some(v))).
#[derive(Debug, Clone, Default)]
pub struct BoardPatch {
    pub name: Option<String>,
    pub position: Option<f64>,
    pub role_id: Option<Option<String>>,
    pub description: Option<Option<String>>,
    /// `None` = leave alone; `Some(None)` = clear; `Some(Some(s))` = set.
    pub color: Option<Option<String>>,
    /// `None` = leave alone; `Some(None)` = clear; `Some(Some(s))` = set.
    pub icon: Option<Option<String>>,
}

/// Partial update via a dynamic SET clause. Bumps `updated_at`. Returns
/// the updated row, or `Ok(None)` if no row matched the id.
///
/// For nullable fields (`role_id`, `description`, `color`, `icon`) the
/// patch uses `Option<Option<T>>`: `None` = skip, `Some(None)` = clear,
/// `Some(Some(v))` = set to `v`. Nullable columns are appended to the
/// SQL only when the patch carries an explicit `Some(_)` — same
/// pattern as `prompt_groups` so the SQL stays linear in the number of
/// patched fields.
///
/// # Errors
///
/// FK violation on `role_id` surfaces as [`DbError::Sqlite`].
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &BoardPatch,
) -> Result<Option<BoardRow>, DbError> {
    use std::fmt::Write as _;
    let now = now_millis();

    let mut sql = String::from(
        "UPDATE boards SET name = COALESCE(?1, name), \
         position = COALESCE(?2, position)",
    );
    let mut next_param = 3_usize;
    let mut params_vec: Vec<rusqlite::types::Value> =
        vec![patch.name.clone().into(), patch.position.into()];

    if let Some(r) = patch.role_id.as_ref() {
        let _ = write!(sql, ", role_id = ?{next_param}");
        params_vec.push(rusqlite::types::Value::from(r.clone()));
        next_param += 1;
    }
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

/// Delete one board. Cascades to `columns` (and their `tasks`),
/// `board_prompts`. Other entity FKs (e.g. tasks.board_id) cascade by
/// schema.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM boards WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

/// Insert one board. Generates id via `nanoid` (21-char URL-safe alphabet,
/// the crate default — collision probability negligible for desktop
/// scale). `created_at` / `updated_at` are stamped from `now_millis`.
///
/// All parameters bound positionally — no string concat (NFR §4.3 SQL
/// injection guard).
///
/// # Errors
///
/// Bubbles any FK violation (`SQLITE_CONSTRAINT_FOREIGNKEY` — bad
/// `space_id` or `role_id`) up to the caller as
/// [`DbError::Sqlite`]; the use-case layer maps it to `AppError::NotFound`.
pub fn insert(conn: &Connection, draft: &BoardDraft) -> Result<BoardRow, DbError> {
    let id = new_id();
    let now = now_millis();
    let position = draft.position.unwrap_or(0.0);
    let is_default = i64::from(draft.is_default);

    let owner = draft
        .owner_role_id
        .clone()
        .unwrap_or_else(|| MAINTAINER_SYSTEM_ID.to_owned());

    conn.execute(
        "INSERT INTO boards \
            (id, name, space_id, role_id, position, description, color, icon, \
             is_default, created_at, updated_at, owner_role_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)",
        params![
            id,
            draft.name,
            draft.space_id,
            draft.role_id,
            position,
            draft.description,
            draft.color,
            draft.icon,
            is_default,
            now,
            owner,
        ],
    )?;

    Ok(BoardRow {
        id,
        name: draft.name.clone(),
        space_id: draft.space_id.clone(),
        role_id: draft.role_id.clone(),
        position,
        description: draft.description.clone(),
        color: draft.color.clone(),
        icon: draft.icon.clone(),
        is_default: draft.is_default,
        created_at: now,
        updated_at: now,
        owner_role_id: owner,
    })
}

/// Deterministic id of the system Maintainer row seeded by migration
/// `004_cat_as_agent_phase1.sql`. Used as the default `owner_role_id`
/// when callers don't specify one — see memo Q1 option (c).
pub const MAINTAINER_SYSTEM_ID: &str = "maintainer-system";

/// Deterministic id of the system Dirizher row seeded by migration
/// `004_cat_as_agent_phase1.sql`. Phase 2 wiring will reference this
/// when routing tasks to the coordinator cat (memo Q3).
pub const DIRIZHER_SYSTEM_ID: &str = "dirizher-system";

/// Reassign a board's owning cat. The `role_id` must reference an
/// existing row in `roles`; the FK constraint enforces this at the
/// schema level, so a missing role surfaces as
/// [`DbError::Sqlite`] with `ConstraintViolation`. Bumps `updated_at`.
///
/// Returns `Ok(false)` if the board id does not exist; otherwise
/// `Ok(true)`. Idempotent on the same `(board_id, role_id)` pair —
/// re-assigning to the same owner just refreshes `updated_at`.
///
/// Cat-as-Agent Phase 1 (ctq-73): the column is non-nullable, so this
/// helper never clears the owner — there is always exactly one.
///
/// # Errors
///
/// FK violation on a missing `role_id` surfaces as [`DbError::Sqlite`].
pub fn set_owner(conn: &Connection, board_id: &str, role_id: &str) -> Result<bool, DbError> {
    let now = now_millis();
    let updated = conn.execute(
        "UPDATE boards SET owner_role_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![role_id, now, board_id],
    )?;
    Ok(updated > 0)
}

/// Returns `true` if a row exists in `spaces` with the given id. Used
/// by the use-case layer to translate a missing-space situation into
/// `AppError::NotFound { entity: "space", ... }` *before* the FK fires
/// — friendlier than letting the driver's `SQLITE_CONSTRAINT_FOREIGNKEY`
/// bubble up.
///
/// # Errors
///
/// Surfaces rusqlite errors only. `Ok(false)` for "row doesn't exist".
pub fn space_exists(conn: &Connection, space_id: &str) -> Result<bool, DbError> {
    let mut stmt = conn.prepare("SELECT 1 FROM spaces WHERE id = ?1")?;
    let exists = stmt.exists(params![space_id])?;
    Ok(exists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("PRAGMA");
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn seed_space(conn: &Connection, id: &str, prefix: &str) {
        conn.execute(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 0, 0, 0, 0)",
            params![id, format!("Space {id}"), prefix],
        )
        .expect("seed space");
    }

    fn empty_draft(name: &str, space_id: &str) -> BoardDraft {
        BoardDraft {
            name: name.into(),
            space_id: space_id.into(),
            role_id: None,
            position: None,
            description: None,
            color: None,
            icon: None,
            is_default: false,
            owner_role_id: None,
        }
    }

    #[test]
    fn list_all_on_empty_db_returns_empty_vec() {
        let conn = fresh_db();
        let rows = list_all(&conn).expect("list");
        assert!(rows.is_empty());
    }

    #[test]
    fn insert_then_list_returns_the_row() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(
            &conn,
            &BoardDraft {
                name: "Board A".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(1.0),
                description: None,
                color: None,
                icon: None,
                is_default: false,
                owner_role_id: None,
            },
        )
        .expect("insert");
        assert_eq!(row.name, "Board A");
        assert_eq!(row.space_id, "sp1");
        assert!((row.position - 1.0).abs() < f64::EPSILON);
        assert_eq!(row.created_at, row.updated_at);

        let rows = list_all(&conn).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0], row);
    }

    #[test]
    fn list_all_orders_by_position_then_name() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        // Migration 016 enforces UNIQUE(space_id, owner_role_id), so each
        // board needs a distinct owner-role row to coexist.
        conn.execute_batch(
            "INSERT INTO roles (id, name, content, created_at, updated_at) VALUES \
                 ('rl-beta','Beta','',0,0), \
                 ('rl-alpha','Alpha','',0,0), \
                 ('rl-zeta','Zeta','',0,0);",
        )
        .unwrap();
        let _b = insert(
            &conn,
            &BoardDraft {
                name: "Beta".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(2.0),
                description: None,
                color: None,
                icon: None,
                is_default: false,
                owner_role_id: Some("rl-beta".into()),
            },
        )
        .unwrap();
        let _a = insert(
            &conn,
            &BoardDraft {
                name: "Alpha".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(2.0),
                description: None,
                color: None,
                icon: None,
                is_default: false,
                owner_role_id: Some("rl-alpha".into()),
            },
        )
        .unwrap();
        let _z = insert(
            &conn,
            &BoardDraft {
                name: "Zeta".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(1.0),
                description: None,
                color: None,
                icon: None,
                is_default: false,
                owner_role_id: Some("rl-zeta".into()),
            },
        )
        .unwrap();
        let rows = list_all(&conn).unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["Zeta", "Alpha", "Beta"]);
    }

    #[test]
    fn get_by_id_returns_none_for_missing() {
        let conn = fresh_db();
        let row = get_by_id(&conn, "does-not-exist").expect("query");
        assert!(row.is_none());
    }

    #[test]
    fn get_by_id_returns_some_for_existing() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let inserted = insert(&conn, &empty_draft("Board", "sp1")).unwrap();
        let fetched = get_by_id(&conn, &inserted.id).unwrap();
        assert_eq!(fetched, Some(inserted));
    }

    #[test]
    fn insert_with_bad_space_violates_fk() {
        let conn = fresh_db();
        // No space seeded; FK should refuse the insert under
        // PRAGMA foreign_keys = ON.
        let err =
            insert(&conn, &empty_draft("Doomed", "ghost")).expect_err("FK violation expected");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected ConstraintViolation, got {other:?}"),
        }
    }

    #[test]
    fn space_exists_reports_correctly() {
        let conn = fresh_db();
        assert!(!space_exists(&conn, "sp1").unwrap());
        seed_space(&conn, "sp1", "abc");
        assert!(space_exists(&conn, "sp1").unwrap());
    }

    #[test]
    fn insert_with_description_roundtrips() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(
            &conn,
            &BoardDraft {
                name: "Described".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: None,
                description: Some("A test description.".into()),
                color: None,
                icon: None,
                is_default: false,
                owner_role_id: None,
            },
        )
        .expect("insert");
        assert_eq!(row.description, Some("A test description.".to_owned()));
        let fetched = get_by_id(&conn, &row.id).unwrap().expect("exists");
        assert_eq!(fetched.description, Some("A test description.".to_owned()));
    }

    #[test]
    fn set_owner_reassigns_between_two_roles() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        // Two user roles to swap between.
        conn.execute_batch(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
                 VALUES ('rA','RA','',0,0), ('rB','RB','',0,0);",
        )
        .unwrap();
        let row = insert(
            &conn,
            &BoardDraft {
                name: "Board".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: None,
                description: None,
                color: None,
                icon: None,
                is_default: false,
                owner_role_id: Some("rA".into()),
            },
        )
        .unwrap();
        assert_eq!(row.owner_role_id, "rA");

        // Reassign to rB.
        assert!(set_owner(&conn, &row.id, "rB").unwrap());
        let after = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(after.owner_role_id, "rB");

        // Reassign back to rA — idempotent on the (board, role) pair.
        assert!(set_owner(&conn, &row.id, "rA").unwrap());
        let final_row = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(final_row.owner_role_id, "rA");

        // Missing board returns Ok(false).
        assert!(!set_owner(&conn, "ghost", "rA").unwrap());
    }

    #[test]
    fn set_owner_rejects_unknown_role_via_fk() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(&conn, &empty_draft("B", "sp1")).unwrap();
        let err = set_owner(&conn, &row.id, "ghost-role").expect_err("FK");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected ConstraintViolation, got {other:?}"),
        }
    }

    #[test]
    fn update_description_set_then_clear() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(&conn, &empty_draft("B", "sp1")).unwrap();

        // Set description.
        let patched = update(
            &conn,
            &row.id,
            &BoardPatch {
                description: Some(Some("hello".into())),
                ..Default::default()
            },
        )
        .unwrap()
        .expect("found");
        assert_eq!(patched.description, Some("hello".to_owned()));

        // Clear description.
        let cleared = update(
            &conn,
            &row.id,
            &BoardPatch {
                description: Some(None),
                ..Default::default()
            },
        )
        .unwrap()
        .expect("found");
        assert_eq!(cleared.description, None);
    }

    // ------------------------------------------------------------------
    // Icon + colour round-trip — mirror of the prompt_groups coverage.
    // ------------------------------------------------------------------

    #[test]
    fn insert_with_icon_and_color_round_trips() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(
            &conn,
            &BoardDraft {
                name: "Iconic".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: None,
                description: None,
                color: Some("#abcdef".into()),
                icon: Some("star".into()),
                is_default: false,
                owner_role_id: None,
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
        seed_space(&conn, "sp1", "abc");
        let row = insert(&conn, &empty_draft("B", "sp1")).unwrap();
        assert_eq!(row.icon, None);

        // Set.
        let after_set = update(
            &conn,
            &row.id,
            &BoardPatch {
                icon: Some(Some("bolt".into())),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_set.icon.as_deref(), Some("bolt"));

        // Change.
        let after_change = update(
            &conn,
            &row.id,
            &BoardPatch {
                icon: Some(Some("heart".into())),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_change.icon.as_deref(), Some("heart"));

        // Clear.
        let after_clear = update(
            &conn,
            &row.id,
            &BoardPatch {
                icon: Some(None),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(after_clear.icon, None);
    }

    #[test]
    fn update_leaves_icon_untouched_when_patch_skips_it() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(
            &conn,
            &BoardDraft {
                name: "B".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: None,
                description: None,
                color: None,
                icon: Some("star".into()),
                is_default: false,
                owner_role_id: None,
            },
        )
        .unwrap();
        // Update only `name`. Icon must survive.
        let updated = update(
            &conn,
            &row.id,
            &BoardPatch {
                name: Some("Renamed".into()),
                ..Default::default()
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
        seed_space(&conn, "sp1", "abc");
        let row = insert(
            &conn,
            &BoardDraft {
                name: "B".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: None,
                description: None,
                color: Some("#112233".into()),
                icon: None,
                is_default: false,
                owner_role_id: None,
            },
        )
        .unwrap();
        let cleared = update(
            &conn,
            &row.id,
            &BoardPatch {
                color: Some(None),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(cleared.color, None);
    }

    // ------------------------------------------------------------------
    // is_default round-trip + list_by_space (migration 009).
    // ------------------------------------------------------------------

    #[test]
    fn insert_with_is_default_round_trips() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(
            &conn,
            &BoardDraft {
                name: "Main".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: Some(0.0),
                description: None,
                color: None,
                icon: Some("PixelInterfaceEssentialList".into()),
                is_default: true,
                owner_role_id: None,
            },
        )
        .unwrap();
        assert!(row.is_default);
        let fetched = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert!(fetched.is_default);
    }

    #[test]
    fn insert_default_is_false_when_omitted() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        let row = insert(&conn, &empty_draft("B", "sp1")).unwrap();
        assert!(!row.is_default);
    }

    #[test]
    fn list_by_space_filters_by_owning_space() {
        let conn = fresh_db();
        seed_space(&conn, "sp1", "abc");
        seed_space(&conn, "sp2", "def");
        // Migration 016: B1 / B2 share `sp1` so they must point at
        // distinct owner-role rows. B3 lives in `sp2` alone.
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES ('rl-b2','RB2','',0,0)",
            [],
        )
        .unwrap();
        let _b1 = insert(&conn, &empty_draft("B1", "sp1")).unwrap();
        let _b2 = insert(
            &conn,
            &BoardDraft {
                name: "B2".into(),
                space_id: "sp1".into(),
                role_id: None,
                position: None,
                description: None,
                color: None,
                icon: None,
                is_default: false,
                owner_role_id: Some("rl-b2".into()),
            },
        )
        .unwrap();
        let _b3 = insert(&conn, &empty_draft("B3", "sp2")).unwrap();
        let in_sp1 = list_by_space(&conn, "sp1").unwrap();
        let in_sp2 = list_by_space(&conn, "sp2").unwrap();
        assert_eq!(in_sp1.len(), 2);
        assert_eq!(in_sp2.len(), 1);
        assert_eq!(in_sp2[0].name, "B3");
    }
}
