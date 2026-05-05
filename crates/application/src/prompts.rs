//! Prompts use case.
//!
//! Wave-E2.4 (Olga). Token-count computation and the 6-source
//! resolver are deferred to E3 — at this layer we accept a `token_count`
//! the caller supplies (or `None`) and store it verbatim.

use catique_domain::Prompt;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::prompts::{self as repo, PromptDraft, PromptPatch, PromptRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

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
                token_count: None, // E3 will compute cl100k_base count
            },
        )
        .map_err(|e| map_db_err_unique(e, "prompt"))?;
        Ok(row_to_prompt(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id missing.
    #[allow(clippy::needless_pass_by_value)]
    #[allow(clippy::too_many_arguments)]
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
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = PromptPatch {
            name: name.map(|n| n.trim().to_owned()),
            content,
            color,
            short_description,
            icon,
            examples,
            token_count: None,
        };
        match repo::update(&conn, &id, &patch).map_err(|e| map_db_err_unique(e, "prompt"))? {
            Some(row) => Ok(row_to_prompt(row)),
            None => Err(AppError::NotFound {
                entity: "prompt".into(),
                id,
            }),
        }
    }

    /// Recompute and persist the token count for a prompt, then return the
    /// refreshed `Prompt`.
    ///
    /// ## Heuristic
    ///
    /// `token_count = (payload_chars + 3) / 4`
    ///
    /// where `payload = content + "\n\n" + examples.join("\n\n")`. Examples
    /// are part of the wire payload an agent receives (the FE wraps each one
    /// in `<example index="N">…</example>`), so they must be counted too.
    /// We use the simple newline-joined form rather than the exact XML
    /// envelope — the count is a coarse approximation anyway (~1 token per 4
    /// UTF-8 chars), and the few extra chars introduced by tags do not
    /// materially change the order of magnitude.
    ///
    /// NOTE: intentionally kept dependency-free (no `tiktoken-rs`). If
    /// accurate per-model counts are ever needed, replace the expression
    /// below and wire the real tokeniser here; the repository and handler
    /// require no further changes.
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
        // 2. Compute — coarse heuristic, see NOTE above.
        // `chars().count()` is at most `usize::MAX`; realistic prompts fit
        // well inside `i64::MAX`, so saturating is fine here.
        #[allow(clippy::cast_possible_wrap)]
        let char_count = tokenisable_payload_chars(&row.content, &row.examples) as i64;
        let count = (char_count + 3) / 4;
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
}
