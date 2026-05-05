//! Tags use case.
//!
//! Wave-E2.4 (Olga). Tag autocomplete / search is deferred to E3.

use catique_domain::{PromptTagMapEntry, Tag};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::tags::{self as repo, TagDraft, TagPatch, TagRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// Tags use case.
pub struct TagsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> TagsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every tag.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Tag>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_tag).collect())
    }

    /// Look up a tag by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Tag, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_tag(row)),
            None => Err(AppError::NotFound {
                entity: "tag".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a tag.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name / bad colour;
    /// `AppError::Conflict` for UNIQUE(name) violation.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(&self, name: String, color: Option<String>) -> Result<Tag, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &TagDraft {
                name: trimmed,
                color,
            },
        )
        .map_err(|e| map_db_err_unique(e, "tag"))?;
        Ok(row_to_tag(row))
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
        color: Option<Option<String>>,
    ) -> Result<Tag, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = TagPatch {
            name: name.map(|n| n.trim().to_owned()),
            color,
        };
        match repo::update(&conn, &id, &patch).map_err(|e| map_db_err_unique(e, "tag"))? {
            Some(row) => Ok(row_to_tag(row)),
            None => Err(AppError::NotFound {
                entity: "tag".into(),
                id,
            }),
        }
    }

    /// Return a `Vec<PromptTagMapEntry>` grouping every `tag_id` by its
    /// `prompt_id`. One bulk SELECT on `prompt_tags` — no N+1.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_tag_map(&self) -> Result<Vec<PromptTagMapEntry>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let pairs = repo::list_prompt_tags_pairs(&conn).map_err(map_db_err)?;

        // Group by prompt_id, preserving insertion order (pairs come back
        // sorted by prompt_id from the SQL layer).
        let mut map: Vec<PromptTagMapEntry> = Vec::new();
        for (prompt_id, tag_id) in pairs {
            if let Some(entry) = map.iter_mut().find(|e| e.prompt_id == prompt_id) {
                entry.tag_ids.push(tag_id);
            } else {
                map.push(PromptTagMapEntry {
                    prompt_id,
                    tag_ids: vec![tag_id],
                });
            }
        }
        Ok(map)
    }

    /// Delete a tag.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id unknown.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "tag".into(),
                id: id.to_owned(),
            })
        }
    }

    /// Atomically replace the set of prompts wearing this tag.
    /// ctq-108: bulk setter symmetric with the role/board/column
    /// variants.
    ///
    /// Unlike role/board/column, tags are **not** part of the prompt-
    /// inheritance chain (they're labels, not scopes), so this setter
    /// does not touch `task_prompts` or call any cascade helper. The
    /// schema's `prompt_tags` join carries no `position` column either —
    /// ordering is alphabetic on the FE (`list_prompt_tags_map`), so we
    /// only ensure the new set replaces the old set atomically.
    ///
    /// `prompt_ids` may be empty: that clears the tag's prompts in one
    /// round-trip. Duplicate ids are silently de-duplicated by the
    /// `INSERT … ON CONFLICT DO NOTHING` in the underlying repo helper —
    /// we re-issue a plain INSERT here for the same effect.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation (unknown
    /// `tag_id` or any prompt id).
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_tag_prompts(
        &self,
        tag_id: String,
        prompt_ids: Vec<String>,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;

        tx.execute(
            "DELETE FROM prompt_tags WHERE tag_id = ?1",
            rusqlite::params![tag_id],
        )
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;

        // Insert the new set with a fresh `added_at` per row. We can't
        // reuse `repositories::tags::add_prompt_tag` here because it
        // takes `&Connection` not `&Transaction`; cloning the SQL keeps
        // the whole bulk write inside one tx.
        let now = now_unix_ms();
        for prompt_id in &prompt_ids {
            tx.execute(
                "INSERT INTO prompt_tags (prompt_id, tag_id, added_at) \
                 VALUES (?1, ?2, ?3) \
                 ON CONFLICT(prompt_id, tag_id) DO NOTHING",
                rusqlite::params![prompt_id, tag_id, now],
            )
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        }

        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }
}

/// Wall-clock unix-ms. Same shape as `tasks::now_unix_ms`. Kept local
/// rather than promoted to a shared util because the use-case layer's
/// only other clock consumer (`tasks::log_step`) inlines the same helper
/// — promoting feels premature with two call-sites.
fn now_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

fn row_to_tag(row: TagRow) -> Tag {
    Tag {
        id: row.id,
        name: row.name,
        color: row.color,
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
        let uc = TagsUseCase::new(&pool);
        match uc.create(String::new(), None).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_name_returns_conflict() {
        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        uc.create("dup".into(), None).unwrap();
        match uc.create("dup".into(), None).expect_err("c") {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "tag"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_get() {
        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        let t = uc.create("rust".into(), Some("#fed7aa".into())).unwrap();
        let got = uc.get(&t.id).unwrap();
        assert_eq!(got.name, "rust");
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "tag"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn list_tag_map_returns_empty_when_no_attachments() {
        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        let map = uc.list_tag_map().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn list_tag_map_groups_by_prompt_id() {
        use catique_infrastructure::db::pool::acquire as acq;
        use catique_infrastructure::db::repositories::prompts as prep;
        use catique_infrastructure::db::repositories::tags as trepo;

        let pool = fresh_pool();
        let uc = TagsUseCase::new(&pool);
        // Create two tags.
        let t1 = uc.create("alpha".into(), None).unwrap();
        let t2 = uc.create("beta".into(), None).unwrap();

        // Insert prompts directly via infrastructure to avoid cross-crate coupling.
        {
            let conn = acq(&pool).unwrap();
            prep::insert(
                &conn,
                &prep::PromptDraft {
                    name: "P1".into(),
                    content: String::new(),
                    color: None,
                    short_description: None,
                    icon: None,
                    examples: Vec::new(),
                    token_count: None,
                },
            )
            .unwrap();
            let p1 = prep::list_all(&conn).unwrap().into_iter().next().unwrap();
            prep::insert(
                &conn,
                &prep::PromptDraft {
                    name: "P2".into(),
                    content: String::new(),
                    color: None,
                    short_description: None,
                    icon: None,
                    examples: Vec::new(),
                    token_count: None,
                },
            )
            .unwrap();
            let p2 = prep::list_all(&conn)
                .unwrap()
                .into_iter()
                .find(|r| r.name == "P2")
                .unwrap();
            trepo::add_prompt_tag(&conn, &p1.id, &t1.id).unwrap();
            trepo::add_prompt_tag(&conn, &p1.id, &t2.id).unwrap();
            trepo::add_prompt_tag(&conn, &p2.id, &t2.id).unwrap();
        }

        let map = uc.list_tag_map().unwrap();
        assert_eq!(map.len(), 2, "two prompts have tags");
        let p1_entry = map.iter().find(|e| e.tag_ids.contains(&t1.id)).unwrap();
        assert!(p1_entry.tag_ids.contains(&t2.id), "P1 has both tags");
        let p2_entry = map
            .iter()
            .find(|e| e.tag_ids == vec![t2.id.clone()])
            .unwrap();
        assert_eq!(p2_entry.tag_ids.len(), 1, "P2 has only t2");
    }

    // -----------------------------------------------------------------
    // ctq-108 — set_tag_prompts bulk setter (no resolver cascade —
    // tags aren't an inheritance scope).
    // -----------------------------------------------------------------

    fn seed_tag_prompts_fixture() -> (Pool, String) {
        let pool = fresh_pool();
        let tag = TagsUseCase::new(&pool).create("rust".into(), None).unwrap();
        {
            let conn = acquire(&pool).unwrap();
            conn.execute_batch(
                "INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p1','P1','',0,0), \
                     ('p2','P2','',0,0), \
                     ('p3','P3','',0,0);",
            )
            .unwrap();
        }
        (pool, tag.id)
    }

    #[test]
    fn set_tag_prompts_replaces_ordering() {
        let (pool, tag_id) = seed_tag_prompts_fixture();
        let uc = TagsUseCase::new(&pool);

        uc.set_tag_prompts(tag_id.clone(), vec!["p1".into(), "p2".into()])
            .unwrap();
        uc.set_tag_prompts(tag_id.clone(), vec!["p3".into(), "p1".into()])
            .unwrap();

        let conn = acquire(&pool).unwrap();
        // prompt_tags has no `position` column — assert membership only.
        let mut ids: Vec<String> = conn
            .prepare("SELECT prompt_id FROM prompt_tags WHERE tag_id = ?1")
            .unwrap()
            .query_map(rusqlite::params![tag_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        ids.sort();
        assert_eq!(ids, vec!["p1".to_string(), "p3".to_string()]);
    }

    #[test]
    fn set_tag_prompts_with_empty_clears_all() {
        let (pool, tag_id) = seed_tag_prompts_fixture();
        let uc = TagsUseCase::new(&pool);
        uc.set_tag_prompts(tag_id.clone(), vec!["p1".into(), "p2".into()])
            .unwrap();
        uc.set_tag_prompts(tag_id.clone(), Vec::new()).unwrap();

        let conn = acquire(&pool).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM prompt_tags WHERE tag_id = ?1",
                rusqlite::params![tag_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn set_tag_prompts_atomic_on_fk_error() {
        let (pool, tag_id) = seed_tag_prompts_fixture();
        let uc = TagsUseCase::new(&pool);
        uc.set_tag_prompts(tag_id.clone(), vec!["p1".into()])
            .unwrap();

        let err = uc
            .set_tag_prompts(
                tag_id.clone(),
                vec!["p2".into(), "ghost".into(), "p3".into()],
            )
            .expect_err("FK violation");
        match err {
            AppError::TransactionRolledBack { .. } => {}
            other => panic!("expected TransactionRolledBack, got {other:?}"),
        }

        // Pre-state: only p1.
        let conn = acquire(&pool).unwrap();
        let ids: Vec<String> = conn
            .prepare("SELECT prompt_id FROM prompt_tags WHERE tag_id = ?1")
            .unwrap()
            .query_map(rusqlite::params![tag_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(ids, vec!["p1".to_string()]);
    }
}
