//! Role-notes use case — per-role retrospective memory (ctq-137 /
//! MEM-S1).
//!
//! ## Surface
//!
//! `RoleNotesUseCase` exposes the standard CRUD pair plus three
//! recall-shaped methods: [`RoleNotesUseCase::list_tags`] (the cloud the
//! agent inspects before inventing new tags), [`RoleNotesUseCase::recall`]
//! (the load path the agent runs before starting work) and
//! [`RoleNotesUseCase::list_for_role`] (the Settings UI feed).
//!
//! ## Tag normalisation
//!
//! The single source of truth for what makes a valid tag is
//! [`normalise_tag`]. The contract:
//!
//!   * trim → ASCII lowercase
//!   * runs of whitespace / `_` collapse to `-`
//!   * strip every char that is not `[a-z0-9-]`
//!   * collapse repeated `-`; trim leading / trailing `-`
//!   * reject if empty after normalisation OR longer than 32 chars
//!
//! Every write path runs every input through this function, so
//! `list_tags` returns the canonical cloud without further work.
//!
//! ## Recall scoring
//!
//! [`RoleNotesUseCase::recall`] follows a closed three-rule set:
//!
//!   1. Pinned notes always load first, regardless of tag overlap.
//!      Sorted by `(priority DESC, created_at DESC)`. They count toward
//!      the limit.
//!   2. Tag-overlap path (when `tags` is non-empty): score each
//!      non-pinned note by `overlap × (1.0 + 0.5 * priority).max(0.5)
//!      × recency_factor`, where `recency_factor = 1 / (1 + days/30)`
//!      gives a soft 30-day half-life.
//!   3. FTS5 fallback (when `tags` is empty AND `query` is non-empty):
//!      run `role_notes_fts MATCH ?` filtered to the role, rank by
//!      `bm25 × priority_factor` (lower bm25 → better).
//!
//! Within the same score band rows surface oldest-first so the LLM
//! sees a stable order across calls (a noisy / changing order on
//! re-runs poisons agent reasoning).
//!
//! Defensive: every input runs through normalisation first; malformed
//! tags fall away silently, and the use case never panics on bad
//! input.

use catique_domain::{RoleNote, RoleNoteAuthor};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::role_notes::{
        self as repo, RoleNoteDraft, RoleNotePatch, RoleNoteRow, TagCountRow,
    },
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{error::AppError, error_map::map_db_err};

/// Cap on tags accepted per write — keeps the `(?,?,…)` IN-list in
/// [`repo::notes_with_any_tag`] within rusqlite's parameter-count
/// budget (999 by default) and the recall surface bounded.
const MAX_TAGS_PER_NOTE: usize = 32;

/// Cap on the `limit` argument to [`RoleNotesUseCase::recall`]. Higher
/// is silently clamped; the agent does not need more than this to make
/// a decision.
const MAX_RECALL_LIMIT: usize = 50;

/// Maximum byte length of a normalised tag. Mirrors the prose in the
/// audit doc (`docs/audit/mcp-tool-surface-audit.md` §4.2) and keeps
/// the FTS5 column from carrying multi-paragraph "tags" by mistake.
const MAX_TAG_LEN: usize = 32;

/// `(tag, count)` aggregation for the role's tag cloud. Mirrors
/// [`repo::TagCountRow`] at the application layer so callers don't
/// reach into the infrastructure crate.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

/// Use case wrapper. Cheap clone (pool is Arc-backed).
pub struct RoleNotesUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> RoleNotesUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// Insert one note + its tag set atomically.
    ///
    /// Tag-list handling: every entry is normalised + deduped before
    /// the write; malformed entries are dropped silently so the agent
    /// can be sloppy without losing the whole note.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation { field: "body", … }` if `body` trims to
    ///   empty.
    /// * `AppError::Validation { field: "tags", … }` if every entry
    ///   in `tags` normalises away — without at least one good tag
    ///   the note becomes recall-orphaned (only the FTS path could
    ///   surface it). Better to refuse and let the agent retry.
    /// * `AppError::NotFound { entity: "role", … }` if `role_id` is
    ///   unknown (caught via FK violation mapped at write time).
    /// * `AppError::NotFound { entity: "task", … }` if `source_task_id`
    ///   is set but unknown.
    #[allow(clippy::needless_pass_by_value)]
    pub fn add(
        &self,
        role_id: &str,
        body: String,
        tags: Vec<String>,
        source_task_id: Option<String>,
        authored_by: RoleNoteAuthor,
    ) -> Result<RoleNote, AppError> {
        let trimmed_body = validate_non_empty_body(&body)?;
        let original_tag_count = tags.len();
        let normalised = normalise_tag_set(&tags);
        // If the caller intended to provide tags but every one of them
        // normalised away, reject loud rather than silently store an
        // unsearchable orphan.
        if !tags.is_empty() && normalised.is_empty() {
            return Err(AppError::Validation {
                field: "tags".into(),
                reason: format!(
                    "every tag failed normalisation (received {original_tag_count}; \
                     valid shape is kebab-case `[a-z0-9-]{{1,{MAX_TAG_LEN}}}`)",
                ),
            });
        }
        // We allow notes without tags — the FTS path can still recall
        // them — but cap the high end so the IN list stays bounded.
        if normalised.len() > MAX_TAGS_PER_NOTE {
            return Err(AppError::Validation {
                field: "tags".into(),
                reason: format!("at most {MAX_TAGS_PER_NOTE} tags per note"),
            });
        }

        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        // Pre-check the role exists so we surface a typed NotFound
        // instead of letting the FK violation collapse into
        // TransactionRolledBack.
        ensure_role_exists(&conn, role_id)?;
        if let Some(ref tid) = source_task_id {
            ensure_task_exists(&conn, tid)?;
        }

        let draft = RoleNoteDraft {
            role_id: role_id.to_owned(),
            source_task_id,
            body: trimmed_body,
            priority: 0,
            pinned: false,
            authored_by: author_to_sql(authored_by).to_owned(),
        };
        let row = repo::insert(&mut conn, &draft, &normalised).map_err(map_db_err)?;
        hydrate(&conn, row)
    }

    /// Partial update. `tags = Some(_)` replaces the entire tag list.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` on empty `body` (when set), or on a
    ///   tag list that fully normalises away.
    /// * `AppError::NotFound` if the id is unknown.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: &str,
        body: Option<String>,
        tags: Option<Vec<String>>,
        priority: Option<i64>,
        pinned: Option<bool>,
    ) -> Result<RoleNote, AppError> {
        let body_trimmed = match body.as_deref() {
            Some(s) => Some(validate_non_empty_body(s)?),
            None => None,
        };
        let normalised_tags = match tags.as_ref() {
            Some(t) => {
                let original = t.len();
                let n = normalise_tag_set(t);
                if !t.is_empty() && n.is_empty() {
                    return Err(AppError::Validation {
                        field: "tags".into(),
                        reason: format!("every tag failed normalisation (received {original})",),
                    });
                }
                if n.len() > MAX_TAGS_PER_NOTE {
                    return Err(AppError::Validation {
                        field: "tags".into(),
                        reason: format!("at most {MAX_TAGS_PER_NOTE} tags per note"),
                    });
                }
                Some(n)
            }
            None => None,
        };

        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = RoleNotePatch {
            body: body_trimmed,
            priority,
            pinned,
        };
        let row = repo::update(&mut conn, id, &patch, normalised_tags.as_deref())
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "role_note".into(),
                id: id.to_owned(),
            })?;
        hydrate(&conn, row)
    }

    /// Delete one note.
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
                entity: "role_note".into(),
                id: id.to_owned(),
            })
        }
    }

    /// Lookup by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id unknown.
    pub fn get(&self, id: &str) -> Result<RoleNote, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(hydrate(&conn, row)?),
            None => Err(AppError::NotFound {
                entity: "role_note".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// List every note for a role (newest first). Used by the
    /// Settings → Role Memory feed; agents should prefer
    /// [`Self::recall`] which biases by overlap + recency.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_for_role(&self, role_id: &str) -> Result<Vec<RoleNote>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn, role_id).map_err(map_db_err)?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(hydrate(&conn, row)?);
        }
        Ok(out)
    }

    /// Return the `(tag, count)` cloud for the role, sorted by count
    /// DESC then tag ASC. Agents call this before writing a note so
    /// they prefer existing tags to invented ones.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_tags(&self, role_id: &str) -> Result<Vec<TagCount>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_tags_for_role(&conn, role_id).map_err(map_db_err)?;
        Ok(rows
            .into_iter()
            .map(|TagCountRow { tag, count }| TagCount { tag, count })
            .collect())
    }

    /// Recall notes for the role under the three-rule scoring
    /// documented in the module-level docs.
    ///
    /// * `tags`  — agent-chosen tag set; empty → FTS fallback.
    /// * `query` — FTS5 query; ignored if `tags` is non-empty.
    /// * `limit` — capped at [`MAX_RECALL_LIMIT`] (50). `0` returns an
    ///   empty Vec without hitting the DB.
    ///
    /// Defensive: every input tag is normalised; malformed tags fall
    /// away silently.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn recall(
        &self,
        role_id: &str,
        tags: &[String],
        query: Option<&str>,
        limit: usize,
    ) -> Result<Vec<RoleNote>, AppError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let limit = limit.min(MAX_RECALL_LIMIT);
        let conn = acquire(self.pool).map_err(map_db_err)?;

        let normalised_tags = normalise_tag_set(tags);

        // 1. Pinned notes — always included. Sort key
        // `(priority DESC, created_at DESC)`.
        let mut pinned_rows = repo::pinned_for_role(&conn, role_id).map_err(map_db_err)?;
        pinned_rows.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then_with(|| b.created_at.cmp(&a.created_at))
        });

        let mut output: Vec<RoleNoteRow> = Vec::new();
        for row in pinned_rows {
            if output.len() >= limit {
                break;
            }
            output.push(row);
        }
        if output.len() >= limit {
            return finalise(&conn, output, limit);
        }

        // 2. Tag-overlap path. Empty tag set falls through to FTS.
        let now_ms = now_unix_ms();
        if !normalised_tags.is_empty() {
            let candidates =
                repo::notes_with_any_tag(&conn, role_id, &normalised_tags).map_err(map_db_err)?;
            let mut scored = Vec::with_capacity(candidates.len());
            for row in candidates {
                let tags_for_note = repo::list_tags_for_note(&conn, &row.id).map_err(map_db_err)?;
                let overlap = count_overlap(&tags_for_note, &normalised_tags);
                if overlap == 0 {
                    // Cheap defence — `notes_with_any_tag` should
                    // already filter, but a stale-cache race could
                    // surface 0-overlap rows.
                    continue;
                }
                let score = score_tag_overlap(overlap, row.priority, row.created_at, now_ms);
                scored.push((score, row));
            }
            // Sort by score DESC, then created_at ASC (oldest first
            // within band — stable across re-runs).
            scored.sort_by(|a, b| {
                b.0.partial_cmp(&a.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.1.created_at.cmp(&b.1.created_at))
            });
            for (_, row) in scored {
                if output.len() >= limit {
                    break;
                }
                output.push(row);
            }
            return finalise(&conn, output, limit);
        }

        // 3. FTS5 fallback (tags empty AND query non-empty).
        if let Some(q) = query.and_then(sanitize_fts_query) {
            let hits = repo::fts_search(&conn, role_id, &q).map_err(map_db_err)?;
            let mut scored = Vec::with_capacity(hits.len());
            for (row, bm25) in hits {
                let score = score_fts(bm25, row.priority);
                scored.push((score, row));
            }
            scored.sort_by(|a, b| {
                b.0.partial_cmp(&a.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.1.created_at.cmp(&b.1.created_at))
            });
            for (_, row) in scored {
                if output.len() >= limit {
                    break;
                }
                output.push(row);
            }
        }

        finalise(&conn, output, limit)
    }
}

// ---------------------------------------------------------------------
// Helpers — kept module-private so the use case is the only writer to
// the contract.
// ---------------------------------------------------------------------

/// Map the typed [`RoleNoteAuthor`] enum to the SQL CHECK-constraint
/// string literal.
fn author_to_sql(a: RoleNoteAuthor) -> &'static str {
    match a {
        RoleNoteAuthor::Agent => "agent",
        RoleNoteAuthor::User => "user",
    }
}

/// Inverse of [`author_to_sql`]. Falls back to `Agent` on malformed
/// stored data — the schema CHECK keeps the value in `('agent','user')`,
/// so the fallback path is unreachable under a non-tampered DB.
fn author_from_sql(s: &str) -> RoleNoteAuthor {
    match s {
        "user" => RoleNoteAuthor::User,
        _ => RoleNoteAuthor::Agent,
    }
}

/// Hydrate a [`RoleNoteRow`] into a domain [`RoleNote`] by joining in
/// the tag list. One extra round-trip per row — acceptable for the
/// recall path (capped at 50 rows) and for the Settings feed (linear).
fn hydrate(conn: &rusqlite::Connection, row: RoleNoteRow) -> Result<RoleNote, AppError> {
    let tags = repo::list_tags_for_note(conn, &row.id).map_err(map_db_err)?;
    Ok(RoleNote {
        id: row.id,
        role_id: row.role_id,
        source_task_id: row.source_task_id,
        body: row.body,
        tags,
        priority: row.priority,
        pinned: row.pinned,
        authored_by: author_from_sql(&row.authored_by),
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// Finalise the recall output: hydrate every row + trim to `limit`.
fn finalise(
    conn: &rusqlite::Connection,
    mut rows: Vec<RoleNoteRow>,
    limit: usize,
) -> Result<Vec<RoleNote>, AppError> {
    rows.truncate(limit);
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(hydrate(conn, row)?);
    }
    Ok(out)
}

/// Cheap existence check. Returns `AppError::NotFound` with the right
/// entity tag when the row is missing.
fn ensure_role_exists(conn: &rusqlite::Connection, role_id: &str) -> Result<(), AppError> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM roles WHERE id = ?1",
            rusqlite::params![role_id],
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
            entity: "role".into(),
            id: role_id.to_owned(),
        })
    }
}

fn ensure_task_exists(conn: &rusqlite::Connection, task_id: &str) -> Result<(), AppError> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM tasks WHERE id = ?1",
            rusqlite::params![task_id],
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
            entity: "task".into(),
            id: task_id.to_owned(),
        })
    }
}

/// Validate + trim a note body. Empty / whitespace-only is rejected
/// with `Validation { field: "body" }`.
fn validate_non_empty_body(body: &str) -> Result<String, AppError> {
    // Reuse the shared validator under the `body` field name so the
    // 200-char hard cap on `validate_non_empty` doesn't fire — notes
    // can run long. Do the empty check inline instead.
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation {
            field: "body".into(),
            reason: "must not be empty or whitespace-only".into(),
        });
    }
    // Light cap: 8 KiB. The agent ships free-form prose, not whole
    // transcripts — anything past this is almost certainly a mistake.
    if trimmed.len() > 8 * 1024 {
        return Err(AppError::Validation {
            field: "body".into(),
            reason: "must be at most 8192 chars".into(),
        });
    }
    Ok(trimmed.to_owned())
}

/// Normalise + dedupe a tag set. Order-preserving on first occurrence.
fn normalise_tag_set(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(tags.len());
    for raw in tags {
        if let Some(t) = normalise_tag(raw) {
            if !out.iter().any(|existing| existing == &t) {
                out.push(t);
            }
        }
    }
    out
}

/// Canonicalise one tag string. Single source of truth for what makes
/// a valid tag — see module-level docs for the contract.
///
/// Returns `None` if the value is empty after normalisation or exceeds
/// [`MAX_TAG_LEN`] (32 chars).
#[must_use]
pub fn normalise_tag(s: &str) -> Option<String> {
    // 1. Trim outer whitespace.
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 2. ASCII lowercase + 3. whitespace/underscore → dash + 4. strip
    // unknown chars. Walking once builds the final byte string.
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        let lc = ch.to_ascii_lowercase();
        if lc.is_ascii_lowercase() || lc.is_ascii_digit() || lc == '-' {
            out.push(lc);
        } else if lc.is_whitespace() || lc == '_' {
            out.push('-');
        }
        // anything else (punctuation, non-ASCII letters, …) is
        // silently dropped — the renderer + IN-list both want strict
        // `[a-z0-9-]`.
    }
    // 5. Collapse repeated dashes.
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_dash = false;
    for ch in out.chars() {
        if ch == '-' {
            if !prev_dash {
                collapsed.push('-');
            }
            prev_dash = true;
        } else {
            collapsed.push(ch);
            prev_dash = false;
        }
    }
    // Trim leading / trailing dashes.
    let final_str = collapsed.trim_matches('-').to_owned();
    // 6. Reject empty / too long.
    if final_str.is_empty() || final_str.len() > MAX_TAG_LEN {
        return None;
    }
    Some(final_str)
}

/// Cardinality of intersection between two slices. Both inputs are
/// normalised so equality is byte-wise.
fn count_overlap(note_tags: &[String], query_tags: &[String]) -> usize {
    note_tags
        .iter()
        .filter(|t| query_tags.iter().any(|q| q == *t))
        .count()
}

/// Tag-overlap score per the module-level rule set:
///
/// `score = overlap × max(0.5, 1.0 + 0.5 × priority) × recency_factor`
///
/// `recency_factor = 1 / (1 + days_since_created / 30)` so a one-month
/// note is half-weight, a six-month note is ~14%.
fn score_tag_overlap(overlap: usize, priority: i64, created_at_ms: i64, now_ms: i64) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let overlap_f = overlap as f64;
    #[allow(clippy::cast_precision_loss)]
    let priority_f = priority as f64;
    let priority_factor = (1.0 + 0.5 * priority_f).max(0.5);
    let age_ms = (now_ms - created_at_ms).max(0);
    #[allow(clippy::cast_precision_loss)]
    let age_days = age_ms as f64 / (1000.0 * 60.0 * 60.0 * 24.0);
    let recency_factor = 1.0 / (1.0 + age_days / 30.0);
    overlap_f * priority_factor * recency_factor
}

/// FTS5 fallback score. Lower bm25 = better match; we negate so higher
/// score = better (matches the tag-overlap convention). Priority
/// multiplies in the same way it does for the tag path.
fn score_fts(bm25: f64, priority: i64) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let priority_f = priority as f64;
    let priority_factor = (1.0 + 0.5 * priority_f).max(0.5);
    // bm25 is non-negative; negate so the highest-quality match scores
    // highest.
    -bm25 * priority_factor
}

/// Best-effort FTS5 query sanitiser. We trust nothing the agent
/// supplies, so a query body that obviously breaks the FTS5 parser
/// (zero non-whitespace, only `"` chars) collapses to `None` and the
/// fallback path returns empty. We deliberately keep this loose
/// rather than re-implementing FTS5's grammar — a stray operator just
/// fails the search; no SQL injection is possible because we always
/// bind the value as a parameter.
fn sanitize_fts_query(q: &str) -> Option<String> {
    let trimmed = q.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Strip the bare double-quote character — FTS5 grammar uses it for
    // phrase quoting, and an unbalanced one raises a runtime parse
    // error. We accept the small loss of phrase-search expressiveness
    // for a robust agent surface.
    let no_quotes: String = trimmed.chars().filter(|c| *c != '"').collect();
    if no_quotes.trim().is_empty() {
        return None;
    }
    Some(no_quotes)
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool_with_role(role_id: &str) -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES (?1, ?1, '', 0, 0)",
            rusqlite::params![role_id],
        )
        .unwrap();
        drop(conn);
        pool
    }

    // -----------------------------------------------------------------
    // Tag normalisation contract.
    // -----------------------------------------------------------------

    #[test]
    fn normalise_tag_lowercases_and_dasherises() {
        assert_eq!(normalise_tag("  RustAsync  ").as_deref(), Some("rustasync"));
        assert_eq!(normalise_tag("hello world").as_deref(), Some("hello-world"));
        assert_eq!(normalise_tag("hello_world").as_deref(), Some("hello-world"));
        assert_eq!(
            normalise_tag("hello\tworld").as_deref(),
            Some("hello-world")
        );
    }

    #[test]
    fn normalise_tag_strips_unknown_chars_and_collapses_dashes() {
        assert_eq!(
            normalise_tag("hello!!!world").as_deref(),
            Some("helloworld"),
            "punctuation is stripped, no leftover dash",
        );
        assert_eq!(
            normalise_tag("hello--world").as_deref(),
            Some("hello-world"),
        );
        assert_eq!(
            normalise_tag("---rust---").as_deref(),
            Some("rust"),
            "outer dashes trimmed",
        );
    }

    #[test]
    fn normalise_tag_rejects_empty_and_too_long() {
        assert!(normalise_tag("").is_none());
        assert!(normalise_tag("   ").is_none());
        assert!(normalise_tag("___").is_none(), "all separators → empty");
        // 33 chars → reject
        let long = "a".repeat(33);
        assert!(normalise_tag(&long).is_none());
        // 32 chars → accept
        let ok = "a".repeat(32);
        assert!(normalise_tag(&ok).is_some());
    }

    // -----------------------------------------------------------------
    // add() / update() validation.
    // -----------------------------------------------------------------

    #[test]
    fn add_with_mixed_valid_invalid_tags_drops_invalid_silently() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        // "rust" survives; the two malformed entries fall away.
        let note = uc
            .add(
                "r1",
                "n".into(),
                vec!["rust".into(), "   ".into(), "###".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .unwrap();
        assert_eq!(note.tags, vec!["rust".to_owned()]);
    }

    #[test]
    fn add_with_all_invalid_tags_returns_validation() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let err = uc
            .add(
                "r1",
                "n".into(),
                vec!["   ".into(), "###".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .expect_err("validation");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "tags"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn add_with_empty_tag_list_succeeds() {
        // Empty input is fine — the FTS path can still recall the note.
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let note = uc
            .add("r1", "n".into(), vec![], None, RoleNoteAuthor::Agent)
            .unwrap();
        assert!(note.tags.is_empty());
    }

    #[test]
    fn add_with_empty_body_returns_validation() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let err = uc
            .add(
                "r1",
                "  ".into(),
                vec!["rust".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .expect_err("v");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "body"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn add_with_unknown_role_returns_not_found() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let err = uc
            .add(
                "ghost",
                "n".into(),
                vec!["rust".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .expect_err("nf");
        match err {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "role");
                assert_eq!(id, "ghost");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_replaces_tags_and_persists() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let note = uc
            .add(
                "r1",
                "n".into(),
                vec!["a".into(), "b".into()],
                None,
                RoleNoteAuthor::User,
            )
            .unwrap();
        let updated = uc
            .update(&note.id, None, Some(vec!["c".into()]), None, Some(true))
            .unwrap();
        assert_eq!(updated.tags, vec!["c".to_owned()]);
        assert!(updated.pinned);
    }

    #[test]
    fn delete_then_get_returns_not_found() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let n = uc
            .add(
                "r1",
                "n".into(),
                vec!["rust".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .unwrap();
        uc.delete(&n.id).unwrap();
        match uc.get(&n.id).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "role_note"),
            other => panic!("got {other:?}"),
        }
    }

    // -----------------------------------------------------------------
    // list_tags + list_for_role.
    // -----------------------------------------------------------------

    #[test]
    fn list_tags_returns_normalised_counts() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        uc.add(
            "r1",
            "n".into(),
            vec!["Rust".into(), "async".into()],
            None,
            RoleNoteAuthor::Agent,
        )
        .unwrap();
        uc.add(
            "r1",
            "m".into(),
            vec!["RUST".into()],
            None,
            RoleNoteAuthor::Agent,
        )
        .unwrap();
        let cloud = uc.list_tags("r1").unwrap();
        // Both normalise to "rust".
        assert_eq!(cloud[0].tag, "rust");
        assert_eq!(cloud[0].count, 2);
        // "async" sits at count 1.
        assert!(cloud.iter().any(|tc| tc.tag == "async" && tc.count == 1));
    }

    #[test]
    fn list_for_role_returns_newest_first() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let first = uc
            .add("r1", "first".into(), vec![], None, RoleNoteAuthor::Agent)
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = uc
            .add("r1", "second".into(), vec![], None, RoleNoteAuthor::Agent)
            .unwrap();
        let list = uc.list_for_role("r1").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, second.id, "newest first");
        assert_eq!(list[1].id, first.id);
    }

    // -----------------------------------------------------------------
    // recall — every branch in the closed rule set.
    // -----------------------------------------------------------------

    #[test]
    fn recall_with_zero_limit_returns_empty() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        uc.add(
            "r1",
            "n".into(),
            vec!["rust".into()],
            None,
            RoleNoteAuthor::Agent,
        )
        .unwrap();
        let out = uc.recall("r1", &["rust".to_owned()], None, 0).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn recall_with_no_tags_and_no_query_returns_only_pinned() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        // Unpinned note matching the empty query — must NOT surface.
        let _u = uc
            .add(
                "r1",
                "regular".into(),
                vec!["rust".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .unwrap();
        // Pinned note — should always surface.
        let pinned = uc
            .add(
                "r1",
                "pinned body".into(),
                vec!["macros".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .unwrap();
        let _ = uc.update(&pinned.id, None, None, None, Some(true)).unwrap();

        let out = uc.recall("r1", &[], None, 10).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, pinned.id);
    }

    #[test]
    fn recall_pinned_always_included_and_counts_toward_limit() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let p = uc
            .add(
                "r1",
                "pinned".into(),
                vec!["misc".into()],
                None,
                RoleNoteAuthor::User,
            )
            .unwrap();
        let _ = uc.update(&p.id, None, None, None, Some(true)).unwrap();
        // Three non-pinned notes that match the recall tag set.
        for body in ["a", "b", "c"] {
            uc.add(
                "r1",
                body.into(),
                vec!["rust".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .unwrap();
        }
        // Limit = 2 — pinned + the highest-scoring non-pinned only.
        let out = uc.recall("r1", &["rust".to_owned()], None, 2).unwrap();
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|n| n.id == p.id), "pinned must surface");
    }

    #[test]
    fn recall_via_tag_overlap_picks_higher_overlap_first() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        let single = uc
            .add(
                "r1",
                "one match".into(),
                vec!["rust".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .unwrap();
        let double = uc
            .add(
                "r1",
                "two matches".into(),
                vec!["rust".into(), "async".into()],
                None,
                RoleNoteAuthor::Agent,
            )
            .unwrap();

        let out = uc
            .recall("r1", &["rust".to_owned(), "async".to_owned()], None, 10)
            .unwrap();
        assert_eq!(out.len(), 2);
        // Double-overlap surfaces first.
        assert_eq!(out[0].id, double.id);
        assert_eq!(out[1].id, single.id);
    }

    #[test]
    fn recall_fts_fallback_runs_when_tags_empty_and_query_present() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        uc.add(
            "r1",
            "tauri ipc handler crash investigation".into(),
            vec![],
            None,
            RoleNoteAuthor::Agent,
        )
        .unwrap();
        uc.add(
            "r1",
            "unrelated body".into(),
            vec![],
            None,
            RoleNoteAuthor::Agent,
        )
        .unwrap();
        let out = uc.recall("r1", &[], Some("tauri"), 5).unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].body.contains("tauri"));
    }

    #[test]
    fn recall_garbage_input_tags_drop_silently_then_fall_through_to_fts() {
        let pool = fresh_pool_with_role("r1");
        let uc = RoleNotesUseCase::new(&pool);
        uc.add(
            "r1",
            "needle body".into(),
            vec![],
            None,
            RoleNoteAuthor::Agent,
        )
        .unwrap();
        // Every input tag normalises away → tag path becomes empty →
        // FTS fallback fires.
        let out = uc
            .recall(
                "r1",
                &["###".to_owned(), "   ".to_owned()],
                Some("needle"),
                5,
            )
            .unwrap();
        assert_eq!(out.len(), 1);
    }
}
