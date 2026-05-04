//! Tasks use case.
//!
//! Wave-E2.4 (Olga). Slug generation lives in the repository
//! (`<space-prefix>-<sequential-int>`, per-space, MAX+1 — see
//! `repositories::tasks`). The use case validates inputs and pre-checks
//! parent existence so `NotFound` is typed.

use catique_domain::{Prompt, Task, TaskRating};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::prompts::PromptRow,
    repositories::task_ratings::{self as ratings_repo, TaskRatingRow},
    repositories::tasks::{self as repo, TaskDraft, TaskPatch, TaskRow},
};
use rusqlite::params;

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// Tasks use case.
pub struct TasksUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> TasksUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every task.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Task>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_task).collect())
    }

    /// Look up a task by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Task, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_task(row)),
            None => Err(AppError::NotFound {
                entity: "task".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a task.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty title; `AppError::NotFound` for
    /// missing `board_id` / `column_id`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        board_id: String,
        column_id: String,
        title: String,
        description: Option<String>,
        position: f64,
        role_id: Option<String>,
    ) -> Result<Task, AppError> {
        let trimmed = validate_non_empty("title", &title)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // Pre-check parents so NotFound is typed (the schema would
        // raise a generic FK error otherwise).
        let board_exists: bool = conn
            .query_row(
                "SELECT 1 FROM boards WHERE id = ?1",
                params![board_id],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !board_exists {
            return Err(AppError::NotFound {
                entity: "board".into(),
                id: board_id,
            });
        }
        let column_exists: bool = conn
            .query_row(
                "SELECT 1 FROM columns WHERE id = ?1 AND board_id = ?2",
                params![column_id, board_id],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !column_exists {
            return Err(AppError::NotFound {
                entity: "column".into(),
                id: column_id,
            });
        }
        let row = repo::insert(
            &conn,
            &TaskDraft {
                board_id,
                column_id,
                title: trimmed,
                description,
                position,
                role_id,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_task(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id missing.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        title: Option<String>,
        description: Option<Option<String>>,
        column_id: Option<String>,
        position: Option<f64>,
        role_id: Option<Option<String>>,
    ) -> Result<Task, AppError> {
        if let Some(t) = title.as_deref() {
            validate_non_empty("title", t)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = TaskPatch {
            title: title.map(|t| t.trim().to_owned()),
            description,
            column_id,
            position,
            role_id,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_task(row)),
            None => Err(AppError::NotFound {
                entity: "task".into(),
                id,
            }),
        }
    }

    /// List the prompts attached to a task, ordered by join-table `position`.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_task_prompts(&self, task_id: &str) -> Result<Vec<Prompt>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_task_prompts(&conn, task_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(prompt_row_to_prompt).collect())
    }

    /// Delete a task.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "task".into(),
                id: id.to_owned(),
            })
        }
    }

    /// Append one step-log line to `task_id`. Cat-as-Agent Phase 1 —
    /// the working cat (or sidecar agent) emits a one-line summary
    /// each time it advances the task; lines accumulate until the
    /// task is rated and archived.
    ///
    /// `summary` is validated for length (≤ 50 000 chars per NFR §4.2);
    /// task existence is pre-checked so the caller gets a typed
    /// `NotFound` rather than a silent zero-row UPDATE.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — `summary` exceeds the length cap.
    /// * `AppError::NotFound`   — task id does not exist.
    /// * Storage-layer errors as usual.
    #[allow(clippy::needless_pass_by_value)]
    pub fn log_step(&self, task_id: String, summary: String) -> Result<(), AppError> {
        if summary.len() > STEP_LOG_SUMMARY_MAX_LEN {
            return Err(AppError::Validation {
                field: "summary".into(),
                reason: format!("must be at most {STEP_LOG_SUMMARY_MAX_LEN} characters"),
            });
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // Pre-check existence so missing-task surfaces as NotFound
        // rather than as a silent zero-row UPDATE.
        if repo::get_by_id(&conn, &task_id)
            .map_err(map_db_err)?
            .is_none()
        {
            return Err(AppError::NotFound {
                entity: "task".into(),
                id: task_id,
            });
        }
        let now = now_unix_ms();
        repo::append_step_log(&conn, &task_id, &summary, now).map_err(map_db_err)
    }

    /// Set or clear the rating for `task_id`. Three-state quality
    /// signal stored as `Option<i8>` per memo Q4 — see
    /// `task_ratings::set_rating` for the UPSERT semantic.
    ///
    /// Validates `rating ∈ {-1, 0, 1, None}` at the use-case layer
    /// (the schema CHECK is the second line of defence). Pre-checks
    /// task existence so a missing id produces a typed `NotFound`
    /// rather than an FK error.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — `rating` is out of range.
    /// * `AppError::NotFound`   — task id does not exist.
    /// * Storage-layer errors as usual.
    #[allow(clippy::needless_pass_by_value)]
    pub fn rate_task(&self, task_id: String, rating: Option<i8>) -> Result<(), AppError> {
        if let Some(v) = rating {
            if !matches!(v, -1..=1) {
                return Err(AppError::Validation {
                    field: "rating".into(),
                    reason: "must be one of -1, 0, +1, or null".into(),
                });
            }
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        if repo::get_by_id(&conn, &task_id)
            .map_err(map_db_err)?
            .is_none()
        {
            return Err(AppError::NotFound {
                entity: "task".into(),
                id: task_id,
            });
        }
        ratings_repo::set_rating(&conn, &task_id, rating).map_err(map_db_err)
    }

    /// Look up the rating row for `task_id`. Returns `Ok(None)` for
    /// tasks that have never been rated; the application layer keeps
    /// the unrated/explicit-neutral distinction (memo Q4 / AC-R2).
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn get_task_rating(&self, task_id: &str) -> Result<Option<TaskRating>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        Ok(ratings_repo::get_rating(&conn, task_id)
            .map_err(map_db_err)?
            .map(row_to_task_rating))
    }
}

/// Wall-clock unix-ms. Mirrors the repository helper; the use-case
/// layer cannot reach `crate::db::repositories::util::now_millis`
/// because that function is `pub(crate)` (see `util.rs`).
fn now_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

fn prompt_row_to_prompt(row: PromptRow) -> Prompt {
    Prompt {
        id: row.id,
        name: row.name,
        content: row.content,
        color: row.color,
        short_description: row.short_description,
        icon: row.icon,
        token_count: row.token_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn row_to_task(row: TaskRow) -> Task {
    Task {
        id: row.id,
        board_id: row.board_id,
        column_id: row.column_id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        position: row.position,
        role_id: row.role_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        step_log: row.step_log,
    }
}

fn row_to_task_rating(row: TaskRatingRow) -> TaskRating {
    TaskRating {
        task_id: row.task_id,
        rating: row.rating,
        rated_at: row.rated_at,
    }
}

/// Hard upper bound on the per-call `summary` length passed to
/// [`TasksUseCase::log_step`]. NFR §4.2 (validation) + the senior
/// engineering bar require an explicit ceiling on every user-supplied
/// string the use-case appends to a persistent buffer; 50 000 chars is
/// the same ceiling the prompt content uses. Each step line is also
/// timestamp-prefixed (~24 chars) — well under SQLite's per-cell
/// 1 GB default.
const STEP_LOG_SUMMARY_MAX_LEN: usize = 50_000;

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','C',0,0);",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn create_then_get() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "Title".into(), None, 1.0, None)
            .unwrap();
        let got = uc.get(&t.id).unwrap();
        assert_eq!(got, t);
    }

    #[test]
    fn create_with_missing_board_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("ghost".into(), "c1".into(), "T".into(), None, 1.0, None)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "board"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_missing_column_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("bd1".into(), "ghost".into(), "T".into(), None, 1.0, None)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "column"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn empty_title_returns_validation() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("bd1".into(), "c1".into(), "  ".into(), None, 1.0, None)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "title"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        let updated = uc
            .update(t.id.clone(), Some("New".into()), None, None, None, None)
            .unwrap();
        assert_eq!(updated.title, "New");
        assert!((updated.position - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn list_task_prompts_returns_prompts_in_position_order() {
        let pool = fresh_pool();
        // Insert prompts + join rows directly.
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO prompts (id, name, content, created_at, updated_at) \
                     VALUES ('px','X','',0,0), ('py','Y','',0,0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        // Attach px at position 5, py at position 1 — py should come first.
        {
            let conn = pool.get().unwrap();
            catique_infrastructure::db::repositories::tasks::add_task_prompt(
                &conn, &task.id, "px", 5.0,
            )
            .unwrap();
            catique_infrastructure::db::repositories::tasks::add_task_prompt(
                &conn, &task.id, "py", 1.0,
            )
            .unwrap();
        }
        let prompts = uc.list_task_prompts(&task.id).unwrap();
        assert_eq!(prompts.len(), 2);
        assert_eq!(prompts[0].id, "py");
        assert_eq!(prompts[1].id, "px");
    }

    #[test]
    fn log_step_appends_three_lines_in_order() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();

        // Three appends with small inter-call sleeps so timestamps
        // are strictly monotonically non-decreasing.
        uc.log_step(task.id.clone(), "first".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        uc.log_step(task.id.clone(), "second".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        uc.log_step(task.id.clone(), "third".into()).unwrap();

        let after = uc.get(&task.id).unwrap();
        let lines: Vec<&str> = after.step_log.lines().collect();
        assert_eq!(
            lines.len(),
            3,
            "three appended lines expected, got: {:?}",
            after.step_log
        );
        // Format: `[YYYY-MM-DDTHH:MM:SSZ] {summary}` — timestamp +
        // single-space + summary; ordering matches insertion order.
        assert!(lines[0].starts_with('['), "line lacks timestamp prefix");
        assert!(lines[0].ends_with(" first"));
        assert!(lines[1].ends_with(" second"));
        assert!(lines[2].ends_with(" third"));
        // Final newline is part of the buffer (each append adds `\n`),
        // so the raw step_log ends with '\n'.
        assert!(after.step_log.ends_with('\n'));
    }

    #[test]
    fn log_step_rejects_oversized_summary() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        let huge = "x".repeat(50_001);
        match uc.log_step(task.id, huge).expect_err("validation") {
            AppError::Validation { field, .. } => assert_eq!(field, "summary"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn log_step_returns_not_found_for_missing_task() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc.log_step("ghost".into(), "x".into()).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn rate_task_round_trip_good_then_bad_then_unrate() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();

        // No row before any rating call.
        assert!(uc.get_task_rating(&task.id).unwrap().is_none());

        // Good (+1).
        uc.rate_task(task.id.clone(), Some(1)).unwrap();
        let r = uc.get_task_rating(&task.id).unwrap().expect("row");
        assert_eq!(r.rating, Some(1));

        // Update to bad (-1).
        uc.rate_task(task.id.clone(), Some(-1)).unwrap();
        let r = uc.get_task_rating(&task.id).unwrap().expect("row");
        assert_eq!(r.rating, Some(-1));

        // Unrate (NULL); row stays so rated_at preserves the unrate
        // moment — memo Q4 / AC-R2 distinction.
        uc.rate_task(task.id.clone(), None).unwrap();
        let r = uc.get_task_rating(&task.id).unwrap().expect("row stays");
        assert_eq!(r.rating, None);
    }

    #[test]
    fn rate_task_rejects_out_of_range() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        match uc.rate_task(task.id, Some(2)).expect_err("validation") {
            AppError::Validation { field, .. } => assert_eq!(field, "rating"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn rate_task_returns_not_found_for_missing_task() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc.rate_task("ghost".into(), Some(1)).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_role_id_persists_it() {
        let pool = fresh_pool();
        // Insert a role so the FK constraint is satisfied.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                 VALUES ('rl-x','Reviewer','',0,0)",
                [],
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create(
                "bd1".into(),
                "c1".into(),
                "With Role".into(),
                None,
                1.0,
                Some("rl-x".into()),
            )
            .unwrap();
        assert_eq!(task.role_id.as_deref(), Some("rl-x"));
        // Round-trip: get should return the same role_id.
        let got = uc.get(&task.id).unwrap();
        assert_eq!(got.role_id.as_deref(), Some("rl-x"));
    }
}
