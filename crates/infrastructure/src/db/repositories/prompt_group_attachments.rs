//! Prompt-group attachments — attach a `PromptGroup` as a *live unit*.
//!
//! Mirrors the individual-prompt write-time materialisation (ADR-0006,
//! see [`super::tasks::cascade_prompt_attachment`]) with a second
//! inheritance dimension: a group attached at a scope fans its CURRENT
//! members into `task_prompts` tagged with a COMPOSITE origin
//! `"<scope>:<id>#group:<gid>"` (or `"direct#group:<gid>"` for a group
//! attached straight to a task). When the group's membership changes,
//! [`rematerialize_prompt_group`] re-expands every attach site — that is
//! the "live" link the feature promises.
//!
//! Layering: these helpers take `&Connection` and never open their own
//! transaction — the use-case layer wraps the whole change (membership
//! edit + rematerialise, or scope set) in one `IMMEDIATE` tx. They DO
//! own effective-count recompute so the invariant "`task_prompts` rows ↔
//! `effective_prompt_count`" never drifts.
//!
//! NFR §4.3: table/column names are `format!`-ed only from the closed
//! [`GroupAttachScope`] enum (fixed literals); every user-supplied value
//! (ids, origin tags, GLOB patterns) is bound via `params!`.

use rusqlite::{params, Connection};

use crate::db::pool::DbError;

use super::prompt_groups;
use super::tasks::{recompute_effective_counts, recompute_effective_counts_for_scope, AttachScope};

/// Scope a prompt group can be attached at. Unlike
/// [`super::tasks::AttachScope`] this includes `Task` — a group attached
/// straight to a task materialises with a `direct#group:<gid>` origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GroupAttachScope {
    Task(String),
    Role(String),
    Column(String),
    Board(String),
    Space(String),
}

impl GroupAttachScope {
    /// Join table holding `(parent_id, group_id, position)` rows.
    fn join_table(&self) -> &'static str {
        match self {
            Self::Task(_) => "task_prompt_groups",
            Self::Role(_) => "role_prompt_groups",
            Self::Column(_) => "column_prompt_groups",
            Self::Board(_) => "board_prompt_groups",
            Self::Space(_) => "space_prompt_groups",
        }
    }

    /// Parent FK column name in the join table.
    fn parent_col(&self) -> &'static str {
        match self {
            Self::Task(_) => "task_id",
            Self::Role(_) => "role_id",
            Self::Column(_) => "column_id",
            Self::Board(_) => "board_id",
            Self::Space(_) => "space_id",
        }
    }

    fn parent_id(&self) -> &str {
        match self {
            Self::Task(id)
            | Self::Role(id)
            | Self::Column(id)
            | Self::Board(id)
            | Self::Space(id) => id,
        }
    }

    /// Composite origin for member rows materialised from `group_id` at
    /// this scope. Round-trips through `OriginRef::parse_with_group`.
    fn origin_tag(&self, group_id: &str) -> String {
        match self {
            Self::Task(_) => format!("direct#group:{group_id}"),
            Self::Role(id) => format!("role:{id}#group:{group_id}"),
            Self::Column(id) => format!("column:{id}#group:{group_id}"),
            Self::Board(id) => format!("board:{id}#group:{group_id}"),
            Self::Space(id) => format!("space:{id}#group:{group_id}"),
        }
    }

    /// GLOB pattern matching EVERY group origin at this scope (any group).
    /// For `Task` the pattern is scope-agnostic (`direct#group:*`) so the
    /// caller must also constrain by `task_id`.
    fn origin_glob(&self) -> String {
        match self {
            Self::Task(_) => "direct#group:*".to_owned(),
            Self::Role(id) => format!("role:{id}#group:*"),
            Self::Column(id) => format!("column:{id}#group:*"),
            Self::Board(id) => format!("board:{id}#group:*"),
            Self::Space(id) => format!("space:{id}#group:*"),
        }
    }

    /// Map to the individual-prompt [`AttachScope`] for count recompute.
    /// `None` for `Task` (recomputed as a single task instead).
    fn as_attach_scope(&self) -> Option<AttachScope> {
        match self {
            Self::Task(_) => None,
            Self::Role(id) => Some(AttachScope::Role(id.clone())),
            Self::Column(id) => Some(AttachScope::Column(id.clone())),
            Self::Board(id) => Some(AttachScope::Board(id.clone())),
            Self::Space(id) => Some(AttachScope::Space(id.clone())),
        }
    }
}

/// List the group ids attached at `scope`, in stored position order.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_groups_at(conn: &Connection, scope: &GroupAttachScope) -> Result<Vec<String>, DbError> {
    let sql = format!(
        "SELECT group_id FROM {} WHERE {} = ?1 ORDER BY position ASC, group_id ASC",
        scope.join_table(),
        scope.parent_col(),
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![scope.parent_id()], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Bulk-set the groups attached at `scope` to `group_ids` (in order).
/// Clears the scope's prior group rows (join + materialised), re-inserts
/// the join rows, expands each group's current members, and recomputes
/// effective counts. Mirrors `set_role_prompts` for individual prompts.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn set_groups_at(
    conn: &Connection,
    scope: &GroupAttachScope,
    group_ids: &[String],
) -> Result<(), DbError> {
    // 1. Drop the scope's existing join rows.
    let del_join = format!(
        "DELETE FROM {} WHERE {} = ?1",
        scope.join_table(),
        scope.parent_col(),
    );
    conn.execute(&del_join, params![scope.parent_id()])?;

    // 2. Drop the scope's materialised group-sourced rows (all groups).
    clear_all_groups_at(conn, scope)?;

    // 3. Re-insert join rows + expand each group's current members.
    let ins_join = format!(
        "INSERT INTO {} ({}, group_id, position) VALUES (?1, ?2, ?3)",
        scope.join_table(),
        scope.parent_col(),
    );
    for (idx, group_id) in group_ids.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = idx as f64;
        conn.execute(&ins_join, params![scope.parent_id(), group_id, position])?;
        expand_group_at(conn, scope, group_id, position)?;
    }

    // 4. Keep effective counts in sync.
    recompute_for(conn, scope)?;
    Ok(())
}

/// Re-materialise a group everywhere it is attached. Called when the
/// group's membership changes (`set_members` / `add_member` /
/// `remove_member`) so every attach site reflects the new member set.
/// Only this group's rows are touched (exact-origin delete) — direct
/// rows and other groups survive.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn rematerialize_prompt_group(conn: &Connection, group_id: &str) -> Result<(), DbError> {
    for_each_site(conn, group_id, |conn, scope, position| {
        clear_group_at(conn, scope, group_id)?;
        expand_group_at(conn, scope, group_id, position)?;
        recompute_for(conn, scope)
    })
}

/// Clear a group's materialised rows from every attach site (no
/// re-expand) and recompute counts. Used on group delete: the
/// `cleanup_prompt_group_origin_on_group_delete` trigger also sweeps the
/// rows defensively, but it does NOT touch `effective_*_count`, so we
/// clear + recompute here before the group row is removed.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn clear_group_everywhere(conn: &Connection, group_id: &str) -> Result<(), DbError> {
    for_each_site(conn, group_id, |conn, scope, _position| {
        clear_group_at(conn, scope, group_id)?;
        recompute_for(conn, scope)
    })
}

// ── internals ────────────────────────────────────────────────────────

/// One inheritance dimension: (join table, parent column, scope ctor).
type Dimension = (&'static str, &'static str, fn(String) -> GroupAttachScope);

/// Visit every attach site of `group_id` across all five dimensions,
/// invoking `f(conn, scope, position)` for each.
fn for_each_site<F>(conn: &Connection, group_id: &str, mut f: F) -> Result<(), DbError>
where
    F: FnMut(&Connection, &GroupAttachScope, f64) -> Result<(), DbError>,
{
    // (join table, parent column, scope constructor) for every dimension.
    let dimensions: [Dimension; 5] = [
        ("task_prompt_groups", "task_id", GroupAttachScope::Task),
        ("role_prompt_groups", "role_id", GroupAttachScope::Role),
        (
            "column_prompt_groups",
            "column_id",
            GroupAttachScope::Column,
        ),
        ("board_prompt_groups", "board_id", GroupAttachScope::Board),
        ("space_prompt_groups", "space_id", GroupAttachScope::Space),
    ];

    for (table, col, ctor) in dimensions {
        let sql = format!("SELECT {col}, position FROM {table} WHERE group_id = ?1");
        let mut stmt = conn.prepare(&sql)?;
        let sites = stmt
            .query_map(params![group_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
            })?
            .collect::<Result<Vec<(String, f64)>, _>>()?;
        drop(stmt);

        for (parent_id, position) in sites {
            let scope = ctor(parent_id);
            f(conn, &scope, position)?;
        }
    }
    Ok(())
}

/// Expand one group's current members onto every task in `scope`.
/// Member positions form a contiguous block after the group's slot
/// (`group_position * 1000 + member_index`) so a group renders together
/// and groups keep their relative order; the resolver's rank tiebreak
/// keeps these below any individual attach at the same scope.
fn expand_group_at(
    conn: &Connection,
    scope: &GroupAttachScope,
    group_id: &str,
    group_position: f64,
) -> Result<(), DbError> {
    let members = prompt_groups::list_members(conn, group_id)?;
    let origin = scope.origin_tag(group_id);
    for (idx, prompt_id) in members.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = group_position * 1000.0 + idx as f64;
        insert_member_row(conn, scope, prompt_id, &origin, position)?;
    }
    Ok(())
}

/// Materialise one member prompt onto every task in `scope` with the
/// composite group origin. `ON CONFLICT DO NOTHING` keeps a pre-existing
/// (higher-precedence) row — parity with `cascade_prompt_attachment`.
fn insert_member_row(
    conn: &Connection,
    scope: &GroupAttachScope,
    prompt_id: &str,
    origin: &str,
    position: f64,
) -> Result<usize, DbError> {
    let n = match scope {
        GroupAttachScope::Task(task_id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![task_id, prompt_id, origin, position],
        )?,
        GroupAttachScope::Role(id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.role_id = ?1 \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![id, prompt_id, origin, position],
        )?,
        GroupAttachScope::Column(id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.column_id = ?1 \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![id, prompt_id, origin, position],
        )?,
        GroupAttachScope::Board(id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t WHERE t.board_id = ?1 \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![id, prompt_id, origin, position],
        )?,
        GroupAttachScope::Space(id) => conn.execute(
            "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
             SELECT t.id, ?2, ?3, ?4 FROM tasks t \
             JOIN boards b ON b.id = t.board_id WHERE b.space_id = ?1 \
             ON CONFLICT(task_id, prompt_id) DO NOTHING",
            params![id, prompt_id, origin, position],
        )?,
    };
    Ok(n)
}

/// Delete every group-sourced row at `scope` (any group). Used by
/// [`set_groups_at`] before re-expanding the new ordered set.
fn clear_all_groups_at(conn: &Connection, scope: &GroupAttachScope) -> Result<usize, DbError> {
    let n = match scope {
        GroupAttachScope::Task(task_id) => conn.execute(
            "DELETE FROM task_prompts WHERE task_id = ?1 AND origin GLOB ?2",
            params![task_id, scope.origin_glob()],
        )?,
        _ => conn.execute(
            "DELETE FROM task_prompts WHERE origin GLOB ?1",
            params![scope.origin_glob()],
        )?,
    };
    Ok(n)
}

/// Delete one group's rows at `scope` (exact composite origin). Leaves
/// direct rows and other groups untouched — used by rematerialise.
fn clear_group_at(
    conn: &Connection,
    scope: &GroupAttachScope,
    group_id: &str,
) -> Result<usize, DbError> {
    let origin = scope.origin_tag(group_id);
    let n = match scope {
        GroupAttachScope::Task(task_id) => conn.execute(
            "DELETE FROM task_prompts WHERE task_id = ?1 AND origin = ?2",
            params![task_id, origin],
        )?,
        // Non-task origins already embed the scope id, so an exact-origin
        // delete only hits this (scope, group)'s rows.
        _ => conn.execute(
            "DELETE FROM task_prompts WHERE origin = ?1",
            params![origin],
        )?,
    };
    Ok(n)
}

/// Recompute effective counts for the scope just mutated.
fn recompute_for(conn: &Connection, scope: &GroupAttachScope) -> Result<(), DbError> {
    match scope.as_attach_scope() {
        Some(attach) => {
            recompute_effective_counts_for_scope(conn, &attach)?;
        }
        None => {
            // Task scope: recompute the single task.
            recompute_effective_counts(conn, scope.parent_id())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repositories::tasks::{self, TaskDraft};
    use crate::db::runner::run_pending;
    use rusqlite::Connection;

    /// Fresh in-memory DB with one space/board/column + a role `rl-x`.
    fn fresh() -> (Connection, String, String) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','Todo',0,0); \
             INSERT INTO roles (id, name, content, created_at, updated_at) \
                 VALUES ('rl-x','X','',0,0);",
        )
        .unwrap();
        (conn, "bd1".into(), "c1".into())
    }

    fn task_on_role(conn: &Connection, board: &str, col: &str, role: Option<&str>) -> String {
        tasks::insert(
            conn,
            &TaskDraft {
                board_id: board.into(),
                column_id: col.into(),
                title: "T".into(),
                description: None,
                kind: "blank".into(),
                position: 1.0,
                role_id: role.map(str::to_owned),
            },
        )
        .unwrap()
        .id
    }

    fn seed_prompt(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES (?1,?1,'',0,0)",
            params![id],
        )
        .unwrap();
    }

    fn seed_group(conn: &Connection, gid: &str, members: &[&str]) {
        conn.execute(
            "INSERT INTO prompt_groups (id, name, position, created_at, updated_at) VALUES (?1,?1,0,0,0)",
            params![gid],
        )
        .unwrap();
        for (i, m) in members.iter().enumerate() {
            let pos = i64::try_from(i).unwrap();
            conn.execute(
                "INSERT INTO prompt_group_members (group_id, prompt_id, position, added_at) VALUES (?1,?2,?3,0)",
                params![gid, m, pos],
            )
            .unwrap();
        }
    }

    fn origins_for(conn: &Connection, task_id: &str) -> Vec<(String, String)> {
        let mut stmt = conn
            .prepare(
                "SELECT prompt_id, origin FROM task_prompts WHERE task_id=?1 ORDER BY position",
            )
            .unwrap();
        stmt.query_map(params![task_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
    }

    #[test]
    fn attach_group_to_role_materialises_members_for_role_tasks() {
        let (conn, bd, col) = fresh();
        seed_prompt(&conn, "p1");
        seed_prompt(&conn, "p2");
        seed_group(&conn, "g1", &["p1", "p2"]);
        let t_on = task_on_role(&conn, &bd, &col, Some("rl-x"));
        let t_off = task_on_role(&conn, &bd, &col, None);

        set_groups_at(
            &conn,
            &GroupAttachScope::Role("rl-x".into()),
            &["g1".into()],
        )
        .unwrap();

        let on = origins_for(&conn, &t_on);
        assert_eq!(
            on,
            vec![
                ("p1".into(), "role:rl-x#group:g1".into()),
                ("p2".into(), "role:rl-x#group:g1".into()),
            ]
        );
        assert!(origins_for(&conn, &t_off).is_empty());
        // effective count reflects the two materialised rows.
        let cnt: i64 = conn
            .query_row(
                "SELECT effective_prompt_count FROM tasks WHERE id=?1",
                params![t_on],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 2);
    }

    #[test]
    fn rematerialise_reflects_membership_changes() {
        let (conn, bd, col) = fresh();
        seed_prompt(&conn, "p1");
        seed_prompt(&conn, "p2");
        seed_group(&conn, "g1", &["p1"]);
        let t = task_on_role(&conn, &bd, &col, Some("rl-x"));
        set_groups_at(
            &conn,
            &GroupAttachScope::Role("rl-x".into()),
            &["g1".into()],
        )
        .unwrap();
        assert_eq!(origins_for(&conn, &t).len(), 1);

        // Add p2 to the group → rematerialise picks it up everywhere.
        conn.execute(
            "INSERT INTO prompt_group_members (group_id, prompt_id, position, added_at) VALUES ('g1','p2',1,0)",
            [],
        )
        .unwrap();
        rematerialize_prompt_group(&conn, "g1").unwrap();
        assert_eq!(origins_for(&conn, &t).len(), 2);

        // Remove p1 → only p2 survives.
        conn.execute(
            "DELETE FROM prompt_group_members WHERE group_id='g1' AND prompt_id='p1'",
            [],
        )
        .unwrap();
        rematerialize_prompt_group(&conn, "g1").unwrap();
        let after = origins_for(&conn, &t);
        assert_eq!(after, vec![("p2".into(), "role:rl-x#group:g1".into())]);
    }

    #[test]
    fn detach_group_preserves_direct_rows() {
        let (conn, bd, col) = fresh();
        seed_prompt(&conn, "p1");
        seed_group(&conn, "g1", &["p1"]);
        let t = task_on_role(&conn, &bd, &col, Some("rl-x"));
        // p1 also attached directly to the task.
        tasks::add_task_prompt(&conn, &t, "p1", 0.5).unwrap();
        set_groups_at(
            &conn,
            &GroupAttachScope::Role("rl-x".into()),
            &["g1".into()],
        )
        .unwrap();
        // Direct row wins the (task,prompt) PK; the group insert is a no-op.
        assert_eq!(origins_for(&conn, &t), vec![("p1".into(), "direct".into())]);

        // Detach the group entirely → direct row survives.
        set_groups_at(&conn, &GroupAttachScope::Role("rl-x".into()), &[]).unwrap();
        assert_eq!(origins_for(&conn, &t), vec![("p1".into(), "direct".into())]);
    }

    #[test]
    fn direct_group_attach_uses_direct_group_origin() {
        let (conn, bd, col) = fresh();
        seed_prompt(&conn, "p1");
        seed_group(&conn, "g1", &["p1"]);
        let t = task_on_role(&conn, &bd, &col, None);
        set_groups_at(&conn, &GroupAttachScope::Task(t.clone()), &["g1".into()]).unwrap();
        assert_eq!(
            origins_for(&conn, &t),
            vec![("p1".into(), "direct#group:g1".into())]
        );
    }

    #[test]
    fn deleting_group_sweeps_materialised_rows_via_trigger() {
        let (conn, bd, col) = fresh();
        seed_prompt(&conn, "p1");
        seed_group(&conn, "g1", &["p1"]);
        let t = task_on_role(&conn, &bd, &col, Some("rl-x"));
        set_groups_at(
            &conn,
            &GroupAttachScope::Role("rl-x".into()),
            &["g1".into()],
        )
        .unwrap();
        assert_eq!(origins_for(&conn, &t).len(), 1);

        // Group delete → cascade removes the attach row; the 037 trigger
        // sweeps the orphaned materialised task_prompts row.
        conn.execute("DELETE FROM prompt_groups WHERE id='g1'", [])
            .unwrap();
        assert!(origins_for(&conn, &t).is_empty());
    }
}
