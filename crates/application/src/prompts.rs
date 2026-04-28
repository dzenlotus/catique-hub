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
    pub fn create(
        &self,
        name: String,
        content: String,
        color: Option<String>,
        short_description: Option<String>,
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
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        content: Option<String>,
        color: Option<Option<String>>,
        short_description: Option<Option<String>>,
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

fn row_to_prompt(row: PromptRow) -> Prompt {
    Prompt {
        id: row.id,
        name: row.name,
        content: row.content,
        color: row.color,
        short_description: row.short_description,
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
            .create(String::new(), String::new(), None, None)
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
        uc.create("Same".into(), String::new(), None, None).unwrap();
        match uc
            .create("Same".into(), String::new(), None, None)
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
            .create("P".into(), "body".into(), None, Some("desc".into()))
            .unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        let got = uc.get(&p.id).unwrap();
        assert_eq!(got.name, "P");
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
}
