//! Skill-steps use case (SKILL-V2-A).
//!
//! Mirrors the [`crate::skills`] use-case shape. Each method follows
//! the same `acquire(pool) → repo::… → row_to_domain` chain so the
//! handler layer can drop them into the existing IPC plumbing.
//!
//! Position semantics:
//!
//!   * `add_step` accepts `Option<f64>`. `None` appends after the
//!     current max position (or `0.0` when the list is empty).
//!   * `reorder_steps` rewrites positions to evenly-spaced floats so
//!     later inserts don't immediately collide. Frontend can keep
//!     sending integer-flavoured floats; the resequencer handles the
//!     spacing.
//!   * `replace_steps` is atomic: wipe + insert inside one
//!     `BEGIN IMMEDIATE` transaction.
//!
//! Validation:
//!
//!   * `title` non-empty + ≤ 200 chars (reuses
//!     [`crate::error_map::validate_non_empty`]).
//!   * `body` is allowed to be empty (the title alone often carries
//!     the action — the body is for the "how").

use catique_domain::SkillStep;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::skill_steps::{
        self as repo, SkillStepDraft as RepoDraft, SkillStepPatch, SkillStepRow,
    },
};

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// One step in the parsed import payload. The use case mints ids and
/// positions at insert time; the draft only carries the user-authored
/// content.
#[derive(Debug, Clone)]
pub struct SkillStepDraft {
    pub title: String,
    pub body: String,
    pub expected_outcome: Option<String>,
}

/// Use case for managing the per-skill ordered step list.
pub struct SkillStepsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> SkillStepsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every step for `skill_id`, ordered by position.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_steps(&self, skill_id: &str) -> Result<Vec<SkillStep>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        ensure_skill_exists(&conn, skill_id)?;
        let rows = repo::list_by_skill(&conn, skill_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_step).collect())
    }

    /// Insert one step. `position = None` appends after the current
    /// max position.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — empty / oversized title.
    /// * `AppError::NotFound` — `skill_id` does not exist.
    #[allow(clippy::needless_pass_by_value)]
    pub fn add_step(
        &self,
        skill_id: &str,
        title: String,
        body: String,
        expected_outcome: Option<String>,
        position: Option<f64>,
    ) -> Result<SkillStep, AppError> {
        let trimmed_title = validate_non_empty("title", &title)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        ensure_skill_exists(&conn, skill_id)?;
        let resolved_position = match position {
            Some(p) => p,
            None => next_position(&conn, skill_id)?,
        };
        let row = repo::insert(
            &conn,
            &RepoDraft {
                skill_id: skill_id.to_owned(),
                position: resolved_position,
                title: trimmed_title,
                body,
                expected_outcome: normalise_optional(expected_outcome),
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_step(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — step id does not exist.
    /// * `AppError::Validation` — empty / oversized title (when supplied).
    #[allow(clippy::needless_pass_by_value)]
    pub fn update_step(
        &self,
        id: &str,
        title: Option<String>,
        body: Option<String>,
        expected_outcome: Option<Option<String>>,
        position: Option<f64>,
    ) -> Result<SkillStep, AppError> {
        if let Some(t) = title.as_deref() {
            validate_non_empty("title", t)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = SkillStepPatch {
            title: title.map(|t| t.trim().to_owned()),
            body,
            expected_outcome: expected_outcome.map(normalise_optional),
            position,
        };
        match repo::update(&conn, id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_step(row)),
            None => Err(AppError::NotFound {
                entity: "skill_step".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Delete one step.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` when no step matches.
    pub fn delete_step(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "skill_step".into(),
                id: id.to_owned(),
            })
        }
    }

    /// Re-position the step list. `step_ids` is the desired order;
    /// missing ids surface as `AppError::BadRequest` so callers don't
    /// silently lose entries. Positions are reset to `1.0, 2.0, 3.0…`
    /// — evenly spaced so insert-between stays cheap.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `skill_id` does not exist.
    /// * `AppError::BadRequest` — supplied ids do not cover every
    ///   existing step exactly once.
    pub fn reorder_steps(&self, skill_id: &str, step_ids: &[String]) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        ensure_skill_exists(&conn, skill_id)?;
        let existing = repo::list_by_skill(&conn, skill_id).map_err(map_db_err)?;
        validate_reorder_set(&existing, step_ids)?;

        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| AppError::TransactionRolledBack {
                reason: format!("reorder tx: {e}"),
            })?;
        #[allow(clippy::cast_precision_loss)]
        for (idx, id) in step_ids.iter().enumerate() {
            let new_pos = (idx as f64) + 1.0;
            let patch = SkillStepPatch {
                position: Some(new_pos),
                ..SkillStepPatch::default()
            };
            // `update` returns Option<row> — None means the id vanished
            // between the existence-check and the UPDATE. Translate to
            // BadRequest so the caller knows the input set drifted.
            if repo::update(&tx, id, &patch).map_err(map_db_err)?.is_none() {
                return Err(AppError::BadRequest {
                    reason: format!("step id `{id}` not found during reorder"),
                });
            }
        }
        tx.commit().map_err(|e| AppError::TransactionRolledBack {
            reason: format!("reorder commit: {e}"),
        })?;
        Ok(())
    }

    /// Atomically swap the step set. Caller-supplied drafts become
    /// the new ordered list (positions resequenced to `1.0, 2.0, …`).
    ///
    /// Used by the git-import flow — the parsed `Vec<ParsedStep>` is
    /// applied in one tx so an observer never sees a half-imported
    /// skill.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — any draft has an empty title.
    /// * `AppError::NotFound` — `skill_id` does not exist.
    pub fn replace_steps(
        &self,
        skill_id: &str,
        drafts: &[SkillStepDraft],
    ) -> Result<Vec<SkillStep>, AppError> {
        // Pre-validate every title up front so a bad draft halfway
        // through doesn't leave us with a partially-committed list.
        let mut sanitised: Vec<SkillStepDraft> = Vec::with_capacity(drafts.len());
        for d in drafts {
            let trimmed = validate_non_empty("title", &d.title)?;
            sanitised.push(SkillStepDraft {
                title: trimmed,
                body: d.body.clone(),
                expected_outcome: normalise_optional(d.expected_outcome.clone()),
            });
        }

        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        ensure_skill_exists(&conn, skill_id)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| AppError::TransactionRolledBack {
                reason: format!("replace_steps tx: {e}"),
            })?;
        #[allow(clippy::cast_precision_loss)]
        let repo_drafts: Vec<RepoDraft> = sanitised
            .iter()
            .enumerate()
            .map(|(idx, d)| RepoDraft {
                skill_id: skill_id.to_owned(),
                position: (idx as f64) + 1.0,
                title: d.title.clone(),
                body: d.body.clone(),
                expected_outcome: d.expected_outcome.clone(),
            })
            .collect();
        let rows = repo::replace_all(&tx, skill_id, &repo_drafts).map_err(map_db_err)?;
        tx.commit().map_err(|e| AppError::TransactionRolledBack {
            reason: format!("replace_steps commit: {e}"),
        })?;
        Ok(rows.into_iter().map(row_to_step).collect())
    }
}

/// Convert a row → domain.
pub(crate) fn row_to_step(row: SkillStepRow) -> SkillStep {
    SkillStep {
        id: row.id,
        skill_id: row.skill_id,
        position: row.position,
        title: row.title,
        body: row.body,
        expected_outcome: row.expected_outcome,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

/// `None | Some("")` → `None`; `Some("   ")` → `None`.
fn normalise_optional(s: Option<String>) -> Option<String> {
    s.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

/// Confirm the skill row exists. The `skill_steps` table FK already
/// guards inserts; this helper surfaces `NotFound` instead of a raw
/// constraint error so the IPC contract stays consistent.
fn ensure_skill_exists(conn: &rusqlite::Connection, skill_id: &str) -> Result<(), AppError> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM skills WHERE id = ?1",
            rusqlite::params![skill_id],
            |_| Ok(()),
        )
        .map(|()| true)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(other),
        })
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "skill".into(),
            id: skill_id.to_owned(),
        })
    }
}

/// Next `position` slot. Returns `max(position) + 1.0` for non-empty
/// lists; `1.0` for the first step.
fn next_position(conn: &rusqlite::Connection, skill_id: &str) -> Result<f64, AppError> {
    let max: Option<f64> = conn
        .query_row(
            "SELECT MAX(position) FROM skill_steps WHERE skill_id = ?1",
            rusqlite::params![skill_id],
            |r| r.get::<_, Option<f64>>(0),
        )
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
    Ok(max.map_or(1.0, |m| m + 1.0))
}

/// Reject reorder requests that don't cover every existing step
/// exactly once.
fn validate_reorder_set(existing: &[SkillStepRow], proposed: &[String]) -> Result<(), AppError> {
    use std::collections::HashSet;
    if existing.len() != proposed.len() {
        return Err(AppError::BadRequest {
            reason: format!(
                "step ids array length ({}) does not match existing step count ({})",
                proposed.len(),
                existing.len(),
            ),
        });
    }
    let existing_ids: HashSet<&str> = existing.iter().map(|r| r.id.as_str()).collect();
    let proposed_ids: HashSet<&str> = proposed.iter().map(String::as_str).collect();
    if existing_ids != proposed_ids {
        return Err(AppError::BadRequest {
            reason: "step ids array must cover every existing step exactly once".into(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool_with_skill() -> (catique_infrastructure::db::pool::Pool, String) {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        drop(conn);
        let uc = crate::skills::SkillsUseCase::new(&pool);
        let s = uc.create("Rust".into(), None, None, 0.0).unwrap();
        (pool, s.id)
    }

    #[test]
    fn add_step_appends_when_position_omitted() {
        let (pool, sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        let a = uc
            .add_step(&sk, "First".into(), String::new(), None, None)
            .unwrap();
        let b = uc
            .add_step(&sk, "Second".into(), String::new(), None, None)
            .unwrap();
        assert!(b.position > a.position);
        let list = uc.list_steps(&sk).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "First");
        assert_eq!(list[1].title, "Second");
    }

    #[test]
    fn add_step_rejects_empty_title() {
        let (pool, sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        match uc
            .add_step(&sk, "   ".into(), String::new(), None, None)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "title"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn add_step_on_missing_skill_returns_not_found() {
        let (pool, _sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        match uc
            .add_step("ghost", "T".into(), String::new(), None, None)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_step_clears_expected_outcome_via_some_none() {
        let (pool, sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        let step = uc
            .add_step(&sk, "T".into(), String::new(), Some("ok".into()), None)
            .unwrap();
        let updated = uc
            .update_step(&step.id, None, None, Some(None), None)
            .unwrap();
        assert!(updated.expected_outcome.is_none());
    }

    #[test]
    fn delete_step_then_not_found() {
        let (pool, sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        let step = uc
            .add_step(&sk, "T".into(), String::new(), None, None)
            .unwrap();
        uc.delete_step(&step.id).unwrap();
        match uc.delete_step(&step.id).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill_step"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn reorder_steps_resequences_positions() {
        let (pool, sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        let a = uc
            .add_step(&sk, "A".into(), String::new(), None, None)
            .unwrap();
        let b = uc
            .add_step(&sk, "B".into(), String::new(), None, None)
            .unwrap();
        let c = uc
            .add_step(&sk, "C".into(), String::new(), None, None)
            .unwrap();
        uc.reorder_steps(&sk, &[c.id.clone(), a.id.clone(), b.id.clone()])
            .unwrap();
        let list = uc.list_steps(&sk).unwrap();
        assert_eq!(list[0].id, c.id);
        assert_eq!(list[1].id, a.id);
        assert_eq!(list[2].id, b.id);
        // Positions are resequenced 1, 2, 3.
        for (idx, step) in list.iter().enumerate() {
            #[allow(clippy::cast_precision_loss)]
            let expected = (idx as f64) + 1.0;
            assert!((step.position - expected).abs() < f64::EPSILON);
        }
    }

    #[test]
    fn reorder_steps_rejects_id_count_mismatch() {
        let (pool, sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        let a = uc
            .add_step(&sk, "A".into(), String::new(), None, None)
            .unwrap();
        let _b = uc
            .add_step(&sk, "B".into(), String::new(), None, None)
            .unwrap();
        match uc
            .reorder_steps(&sk, std::slice::from_ref(&a.id))
            .expect_err("br")
        {
            AppError::BadRequest { reason } => {
                assert!(reason.contains("length"));
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn replace_steps_swaps_atomically() {
        let (pool, sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        uc.add_step(&sk, "Old1".into(), String::new(), None, None)
            .unwrap();
        uc.add_step(&sk, "Old2".into(), String::new(), None, None)
            .unwrap();

        let inserted = uc
            .replace_steps(
                &sk,
                &[
                    SkillStepDraft {
                        title: "New1".into(),
                        body: "b1".into(),
                        expected_outcome: Some("ok".into()),
                    },
                    SkillStepDraft {
                        title: "New2".into(),
                        body: String::new(),
                        expected_outcome: None,
                    },
                ],
            )
            .unwrap();
        assert_eq!(inserted.len(), 2);
        let list = uc.list_steps(&sk).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "New1");
        assert_eq!(list[1].title, "New2");
        // Old rows are gone.
        assert!(!list.iter().any(|s| s.title.starts_with("Old")));
    }

    #[test]
    fn replace_steps_rejects_empty_draft_title() {
        let (pool, sk) = fresh_pool_with_skill();
        let uc = SkillStepsUseCase::new(&pool);
        match uc
            .replace_steps(
                &sk,
                &[SkillStepDraft {
                    title: "  ".into(),
                    body: String::new(),
                    expected_outcome: None,
                }],
            )
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "title"),
            other => panic!("got {other:?}"),
        }
    }
}
