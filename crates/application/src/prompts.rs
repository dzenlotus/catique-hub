//! Prompts use case.
//!
//! Wave-E2.4 (Olga). Token counts are computed automatically on every
//! `create`/`update` via the dependency-free [`estimate_token_count`]
//! heuristic (B6); [`PromptsUseCase::recompute_token_count`] offers an
//! explicit on-demand refresh. The 6-source resolver is deferred to E3.

use catique_domain::Prompt;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::content_versions::{self as versions, ContentVersionRow},
    repositories::prompts::{self as repo, PromptDraft, PromptPatch, PromptRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// D-C: how many content versions to keep per prompt.
const PROMPT_VERSION_RETENTION: usize = 50;
/// D-C: 5-minute debounce window (in milliseconds) between snapshots
/// of `prompt.content`. See `RolesUseCase` for the rationale.
const PROMPT_VERSION_DEBOUNCE_MS: i64 = 5 * 60 * 1_000;

/// Prompts use case.
pub struct PromptsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> PromptsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every prompt, ordered by name.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Prompt>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_prompt).collect())
    }

    /// Look up a prompt by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Prompt, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_prompt(row)),
            None => Err(AppError::NotFound {
                entity: "prompt".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a prompt.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name / bad colour;
    /// `AppError::Conflict` for UNIQUE(name) violation.
    #[allow(clippy::needless_pass_by_value)]
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        name: String,
        content: String,
        color: Option<String>,
        short_description: Option<String>,
        icon: Option<String>,
        examples: Vec<String>,
    ) -> Result<Prompt, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        let token_count = Some(estimate_token_count(&content, &examples));
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &PromptDraft {
                name: trimmed,
                content,
                color,
                short_description,
                icon,
                examples,
                token_count,
            },
        )
        .map_err(|e| map_db_err_unique(e, "prompt"))?;
        Ok(row_to_prompt(row))
    }

    /// Partial update.
    ///
    /// **D-C version history**: when `content` is `Some(_)` AND it
    /// actually changes the stored value, a debounced snapshot of the
    /// *previous* content lands in `prompt_content_versions` (one row
    /// per 5-min editing window, last 50 rows retained per prompt).
    /// Name, color, examples and the rest are not history-tracked.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id missing.
    #[allow(clippy::needless_pass_by_value)]
    #[allow(clippy::too_many_arguments)]
    // See `RolesUseCase::update` for the rationale on `Option<Option<T>>`
    // as the project-wide tri-state patch encoding.
    #[allow(clippy::option_option)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        content: Option<String>,
        color: Option<Option<String>>,
        short_description: Option<Option<String>>,
        icon: Option<Option<String>>,
        examples: Option<Vec<String>>,
    ) -> Result<Prompt, AppError> {
        self.update_with_clock(
            id,
            name,
            content,
            color,
            short_description,
            icon,
            examples,
            default_clock,
        )
    }

    /// Clock-injected variant of [`Self::update`].
    ///
    /// # Errors
    ///
    /// See [`Self::update`].
    #[allow(clippy::needless_pass_by_value)]
    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::option_option)]
    pub(crate) fn update_with_clock<F>(
        &self,
        id: String,
        name: Option<String>,
        content: Option<String>,
        color: Option<Option<String>>,
        short_description: Option<Option<String>>,
        icon: Option<Option<String>>,
        examples: Option<Vec<String>>,
        clock: F,
    ) -> Result<Prompt, AppError>
    where
        F: Fn() -> i64,
    {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;

        if let Some(new_content) = content.as_deref() {
            let previous = repo::get_by_id(&tx, &id).map_err(map_db_err)?;
            if let Some(prev) = previous {
                if prev.content != new_content {
                    snapshot_prompt_if_due(&tx, &id, &prev.content, clock())?;
                }
            }
        }

        let patch = PromptPatch {
            name: name.map(|n| n.trim().to_owned()),
            content,
            color,
            short_description,
            icon,
            examples,
            // Recomputed below from the *merged* row, because `content` and
            // `examples` may be partial patches — the only way to get a
            // count consistent with the persisted payload is to read the
            // result back and re-derive it.
            token_count: None,
        };
        let updated = repo::update(&tx, &id, &patch).map_err(|e| map_db_err_unique(e, "prompt"))?;
        let Some(row) = updated else {
            return Err(AppError::NotFound {
                entity: "prompt".into(),
                id,
            });
        };
        // Re-derive the cached token count from the merged content + examples
        // and persist it inside the same transaction so the row is always
        // self-consistent.
        let token_count = estimate_token_count(&row.content, &row.examples);
        repo::set_token_count(&tx, &id, token_count).map_err(map_db_err)?;
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        let mut prompt = row_to_prompt(row);
        prompt.token_count = Some(token_count);
        Ok(prompt)
    }

    /// List the last 50 content-version rows for a prompt, newest first.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_prompt_versions(
        &self,
        prompt_id: &str,
    ) -> Result<Vec<PromptContentVersion>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = versions::list_prompt_versions(&conn, prompt_id, PROMPT_VERSION_RETENTION)
            .map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_version).collect())
    }

    /// Fetch the full content of one prompt version by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the version id is unknown.
    pub fn get_prompt_version(&self, version_id: &str) -> Result<PromptContentVersion, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = versions::get_prompt_version(&conn, version_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "prompt_content_version".into(),
                id: version_id.to_owned(),
            })?;
        Ok(row_to_version(row))
    }

    /// Revert a prompt's content to the value stored in `version_id`.
    /// Pre-revert content is itself snapshotted (subject to the 5-min
    /// debounce); the target version row stays put.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if `version_id` is unknown.
    pub fn revert_prompt_to_version(&self, version_id: &str) -> Result<Prompt, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let version = versions::get_prompt_version(&conn, version_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "prompt_content_version".into(),
                id: version_id.to_owned(),
            })?;
        drop(conn);
        self.update(
            version.source_id.clone(),
            None,
            Some(version.content),
            None,
            None,
            None,
            None,
        )
    }

    /// Recompute and persist the token count for a prompt, then return the
    /// refreshed `Prompt`.
    ///
    /// `create` and `update` already persist a count on every write via the
    /// shared [`estimate_token_count`] heuristic; this command exists for an
    /// explicit, on-demand refresh (e.g. after a backfill or heuristic change).
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if `id` is unknown.
    #[allow(clippy::needless_pass_by_value)]
    pub fn recompute_token_count(&self, id: String) -> Result<Prompt, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // 1. Fetch — propagate NotFound if absent.
        let row = repo::get_by_id(&conn, &id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "prompt".into(),
                id: id.clone(),
            })?;
        // 2. Compute — coarse heuristic, see NOTE above and
        // [`estimate_token_count`].
        let count = estimate_token_count(&row.content, &row.examples);
        // 3. Persist.
        repo::set_token_count(&conn, &id, count).map_err(map_db_err)?;
        // 4. Re-fetch so the returned value is authoritative.
        let fresh = repo::get_by_id(&conn, &id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "prompt".into(),
                id,
            })?;
        Ok(row_to_prompt(fresh))
    }

    /// Delete a prompt.
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
                entity: "prompt".into(),
                id: id.to_owned(),
            })
        }
    }
}

/// Single source of truth for the prompt token-count heuristic, shared by
/// [`PromptsUseCase::create`], [`PromptsUseCase::update`] and
/// [`PromptsUseCase::recompute_token_count`].
///
/// ## Heuristic
///
/// `token_count = (payload_chars + 3) / 4`
///
/// where `payload = content + "\n\n" + examples.join("\n\n")` (see
/// [`tokenisable_payload_chars`]). Examples are part of the wire payload an
/// agent receives, so they are counted too. The result is a coarse
/// approximation (~1 token per 4 UTF-8 chars).
///
/// NOTE: intentionally kept dependency-free (no `tiktoken-rs`). If accurate
/// per-model counts are ever needed, replace the expression below and wire the
/// real tokeniser here; callers require no further changes.
fn estimate_token_count(content: &str, examples: &[String]) -> i64 {
    // `chars().count()` is at most `usize::MAX`; realistic prompts fit well
    // inside `i64::MAX`, so saturating-to-i64 is fine here.
    #[allow(clippy::cast_possible_wrap)]
    let char_count = tokenisable_payload_chars(content, examples) as i64;
    (char_count + 3) / 4
}

/// Count `char`s of the canonical "what the agent receives" payload:
/// `content` followed by every example, separated by blank lines. Centralised
/// so the heuristic stays in one place and is straightforward to test.
fn tokenisable_payload_chars(content: &str, examples: &[String]) -> usize {
    let mut total = content.chars().count();
    for example in examples {
        // "\n\n" between segments — two ASCII chars, two `char`s.
        total = total
            .saturating_add(2)
            .saturating_add(example.chars().count());
    }
    total
}

fn row_to_prompt(row: PromptRow) -> Prompt {
    Prompt {
        id: row.id,
        name: row.name,
        content: row.content,
        color: row.color,
        short_description: row.short_description,
        icon: row.icon,
        examples: row.examples,
        token_count: row.token_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

/// D-C: snapshot the PRE-update content of `prompt_id` if the most-
/// recent version row is at least [`PROMPT_VERSION_DEBOUNCE_MS`] old
/// (or no version row exists yet), then prune everything beyond
/// [`PROMPT_VERSION_RETENTION`].
fn snapshot_prompt_if_due(
    conn: &rusqlite::Connection,
    prompt_id: &str,
    pre_update_content: &str,
    now_ms: i64,
) -> Result<(), AppError> {
    let due =
        match versions::latest_prompt_version_timestamp(conn, prompt_id).map_err(map_db_err)? {
            Some(latest) => now_ms.saturating_sub(latest) >= PROMPT_VERSION_DEBOUNCE_MS,
            None => true,
        };
    if due {
        versions::insert_prompt_version_at(conn, prompt_id, pre_update_content, None, now_ms)
            .map_err(map_db_err)?;
        versions::prune_prompt_versions(conn, prompt_id, PROMPT_VERSION_RETENTION)
            .map_err(map_db_err)?;
    }
    Ok(())
}

/// D-C: one content-version row returned to the IPC layer. Wire shape
/// lives in `crates/api/src/handlers/prompts.rs` (ts-rs export).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptContentVersion {
    pub id: String,
    pub prompt_id: String,
    pub content: String,
    pub created_at: i64,
    pub author_note: Option<String>,
}

fn row_to_version(row: ContentVersionRow) -> PromptContentVersion {
    PromptContentVersion {
        id: row.id,
        prompt_id: row.source_id,
        content: row.content,
        created_at: row.created_at,
        author_note: row.author_note,
    }
}

/// Wall-clock seed for [`PromptsUseCase::update`]. Mirrors the helper in
/// `roles.rs` — see that file for the saturating overflow rationale.
fn default_clock() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        match uc
            .create(String::new(), String::new(), None, None, None, Vec::new())
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_name_returns_conflict() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        uc.create("Same".into(), String::new(), None, None, None, Vec::new())
            .unwrap();
        match uc
            .create("Same".into(), String::new(), None, None, None, Vec::new())
            .expect_err("c")
        {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "prompt"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list_then_get() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let p = uc
            .create(
                "P".into(),
                "body".into(),
                None,
                Some("desc".into()),
                Some("star".into()),
                vec!["ex1".into(), "ex2".into()],
            )
            .unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        let got = uc.get(&p.id).unwrap();
        assert_eq!(got.name, "P");
        assert_eq!(got.icon.as_deref(), Some("star"));
        assert_eq!(got.examples, vec!["ex1", "ex2"]);
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "prompt"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_persists_token_count_immediately() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        // "Hello" = 5 chars → (5 + 3) / 4 = 2 tokens. With no examples the
        // create-time count must already match the recompute heuristic.
        let p = uc
            .create(
                "TC_CREATE".into(),
                "Hello".into(),
                None,
                None,
                None,
                Vec::new(),
            )
            .unwrap();
        assert_eq!(p.token_count, Some(2));
        // It is genuinely persisted, not just present on the returned struct.
        assert_eq!(uc.get(&p.id).unwrap().token_count, Some(2));
    }

    #[test]
    fn create_counts_examples_in_token_count() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        // payload chars = 5 + (2 + 5) + (2 + 7) = 21 → (21 + 3) / 4 = 6.
        let p = uc
            .create(
                "TC_CREATE_EX".into(),
                "Hello".into(),
                None,
                None,
                None,
                vec!["world".into(), "goodbye".into()],
            )
            .unwrap();
        assert_eq!(p.token_count, Some(6));
    }

    #[test]
    fn update_persists_recomputed_token_count() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let p = uc
            .create(
                "TC_UPDATE".into(),
                "Hello".into(),
                None,
                None,
                None,
                Vec::new(),
            )
            .unwrap();
        assert_eq!(p.token_count, Some(2));
        // Replace the content with a longer body: "Hello there" = 11 chars
        // → (11 + 3) / 4 = 3 tokens.
        let after = uc
            .update(
                p.id.clone(),
                None,
                Some("Hello there".into()),
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(after.token_count, Some(3));
        assert_eq!(uc.get(&p.id).unwrap().token_count, Some(3));
    }

    #[test]
    fn update_recounts_when_only_examples_change() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        // content "Hello" (5) → 2 tokens at create time.
        let p = uc
            .create(
                "TC_UPDATE_EX".into(),
                "Hello".into(),
                None,
                None,
                None,
                Vec::new(),
            )
            .unwrap();
        assert_eq!(p.token_count, Some(2));
        // Touch only examples; the merged payload must drive the new count:
        // 5 + (2 + 5) = 12 → (12 + 3) / 4 = 3.
        let after = uc
            .update(
                p.id.clone(),
                None,
                None,
                None,
                None,
                None,
                Some(vec!["world".into()]),
            )
            .unwrap();
        assert_eq!(after.token_count, Some(3));
        assert_eq!(uc.get(&p.id).unwrap().token_count, Some(3));
    }

    #[test]
    fn recompute_token_count_stores_heuristic_value() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        // "Hello" = 5 chars → (5 + 3) / 4 = 2 tokens.
        let p = uc
            .create("TC".into(), "Hello".into(), None, None, None, Vec::new())
            .unwrap();
        let updated = uc.recompute_token_count(p.id.clone()).unwrap();
        assert_eq!(updated.token_count, Some(2));
        assert_eq!(updated.id, p.id);
    }

    #[test]
    fn update_can_replace_examples() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let p = uc
            .create(
                "EX".into(),
                String::new(),
                None,
                None,
                None,
                vec!["initial".into()],
            )
            .unwrap();
        let after = uc
            .update(
                p.id.clone(),
                None,
                None,
                None,
                None,
                None,
                Some(vec!["replaced".into(), "twice".into()]),
            )
            .unwrap();
        assert_eq!(after.examples, vec!["replaced", "twice"]);
    }

    #[test]
    fn update_can_clear_examples_via_empty_vec() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let p = uc
            .create(
                "CLR".into(),
                String::new(),
                None,
                None,
                None,
                vec!["before".into()],
            )
            .unwrap();
        let after = uc
            .update(p.id, None, None, None, None, None, Some(Vec::new()))
            .unwrap();
        assert!(after.examples.is_empty());
    }

    #[test]
    fn recompute_token_count_includes_examples_in_payload() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        // Same content as `recompute_token_count_stores_heuristic_value`
        // ("Hello", 5 chars → 2 tokens) but with two examples appended.
        // payload chars = 5 + (2 + 5) + (2 + 7) = 21
        // tokens = (21 + 3) / 4 = 6
        let p = uc
            .create(
                "TC_EX".into(),
                "Hello".into(),
                None,
                None,
                None,
                vec!["world".into(), "goodbye".into()],
            )
            .unwrap();
        let updated = uc.recompute_token_count(p.id).unwrap();
        assert_eq!(updated.token_count, Some(6));
    }

    #[test]
    fn recompute_token_count_grows_when_examples_added() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let p = uc
            .create(
                "TC_GROW".into(),
                "body".into(),
                None,
                None,
                None,
                Vec::new(),
            )
            .unwrap();
        let baseline = uc
            .recompute_token_count(p.id.clone())
            .unwrap()
            .token_count
            .expect("baseline count");
        // Append a non-empty example.
        uc.update(
            p.id.clone(),
            None,
            None,
            None,
            None,
            None,
            Some(vec!["a much longer example body".into()]),
        )
        .unwrap();
        let after = uc
            .recompute_token_count(p.id)
            .unwrap()
            .token_count
            .expect("updated count");
        assert!(
            after > baseline,
            "expected examples to bump token count: baseline={baseline}, after={after}"
        );
    }

    #[test]
    fn tokenisable_payload_chars_counts_separators() {
        // "ab" + "\n\n" + "cd" + "\n\n" + "ef" = 2 + 2 + 2 + 2 + 2 = 10
        let n = tokenisable_payload_chars("ab", &["cd".to_owned(), "ef".to_owned()]);
        assert_eq!(n, 10);
        // Empty examples vec keeps content-only behaviour.
        assert_eq!(tokenisable_payload_chars("hello", &[]), 5);
    }

    #[test]
    fn recompute_token_count_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        match uc.recompute_token_count("ghost".into()).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "prompt"),
            other => panic!("got {other:?}"),
        }
    }

    // -----------------------------------------------------------------
    // D-C — content-version history: debounce, retention, revert.
    // -----------------------------------------------------------------

    fn fixed_clock(value: i64) -> impl Fn() -> i64 {
        move || value
    }

    fn count_prompt_versions(pool: &Pool, prompt_id: &str) -> i64 {
        let conn = acquire(pool).unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM prompt_content_versions WHERE prompt_id = ?1",
            rusqlite::params![prompt_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn make_prompt(uc: &PromptsUseCase<'_>, name: &str, content: &str) -> String {
        uc.create(
            name.to_owned(),
            content.to_owned(),
            None,
            None,
            None,
            Vec::new(),
        )
        .unwrap()
        .id
    }

    #[test]
    fn t1_prompt_update_within_debounce_window_writes_single_version() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let id = make_prompt(&uc, "Debouncer", "v0");
        uc.update_with_clock(
            id.clone(),
            None,
            Some("v1".into()),
            None,
            None,
            None,
            None,
            fixed_clock(10_000),
        )
        .unwrap();
        uc.update_with_clock(
            id.clone(),
            None,
            Some("v2".into()),
            None,
            None,
            None,
            None,
            fixed_clock(10_500),
        )
        .unwrap();
        assert_eq!(count_prompt_versions(&pool, &id), 1);
        let listed = uc.list_prompt_versions(&id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].content, "v0");
    }

    #[test]
    fn t2_prompt_update_beyond_debounce_window_writes_new_version() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let id = make_prompt(&uc, "Sessioned", "v0");
        uc.update_with_clock(
            id.clone(),
            None,
            Some("v1".into()),
            None,
            None,
            None,
            None,
            fixed_clock(10_000),
        )
        .unwrap();
        let later = 10_000 + 6 * 60 * 1_000;
        uc.update_with_clock(
            id.clone(),
            None,
            Some("v2".into()),
            None,
            None,
            None,
            None,
            fixed_clock(later),
        )
        .unwrap();
        assert_eq!(count_prompt_versions(&pool, &id), 2);
        let listed = uc.list_prompt_versions(&id).unwrap();
        assert_eq!(listed[0].content, "v1");
        assert_eq!(listed[1].content, "v0");
    }

    #[test]
    fn t3_prompt_version_retention_caps_at_fifty() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let id = make_prompt(&uc, "Prolific", "v0");
        let step = 10 * 60 * 1_000_i64;
        for i in 1..=51_i64 {
            uc.update_with_clock(
                id.clone(),
                None,
                Some(format!("v{i}")),
                None,
                None,
                None,
                None,
                fixed_clock(step.saturating_mul(i)),
            )
            .unwrap();
        }
        assert_eq!(count_prompt_versions(&pool, &id), 50);
        let listed = uc.list_prompt_versions(&id).unwrap();
        assert_eq!(listed.len(), 50);
        assert_eq!(listed[0].content, "v50");
        assert_eq!(listed[49].content, "v1");
    }

    #[test]
    fn t4_revert_prompt_to_version_sets_content_and_snapshots_pre_revert() {
        let pool = fresh_pool();
        let uc = PromptsUseCase::new(&pool);
        let id = make_prompt(&uc, "Reverter", "v0");
        uc.update_with_clock(
            id.clone(),
            None,
            Some("v1".into()),
            None,
            None,
            None,
            None,
            fixed_clock(10_000),
        )
        .unwrap();
        let v0_row = uc
            .list_prompt_versions(&id)
            .unwrap()
            .into_iter()
            .find(|v| v.content == "v0")
            .expect("v0 snapshot");
        let after = uc.revert_prompt_to_version(&v0_row.id).unwrap();
        assert_eq!(after.content, "v0");
        let listed = uc.list_prompt_versions(&id).unwrap();
        assert_eq!(listed.len(), 2);
        let contents: Vec<&str> = listed.iter().map(|v| v.content.as_str()).collect();
        assert!(contents.contains(&"v0"));
        assert!(contents.contains(&"v1"));
    }
}
