//! Search use case — wraps FTS5 repository functions.
//!
//! `SearchUseCase` is a thin orchestrator: it acquires a connection from
//! the pool and delegates to the repository layer. No business logic
//! lives here beyond the limit defaults and error mapping.
//!
//! **Empty query**: returns an empty `Vec` rather than `Validation` —
//! the query box may be empty on first render and the frontend should
//! receive an empty result set, not an error.
//!
//! **`search_all`**: concatenates task results followed by report results.
//! Ordering *within* each slice is FTS5 BM25 rank (lower = better, as
//! SQLite exposes it). True interleaving of the two rank sequences would
//! require a normalisation step; that complexity is out of scope for this
//! slice — see follow-up E4.x "unified BM25-rank interleaving in search_all".

use catique_domain::SearchResult;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::search as repo,
};

use crate::{error::AppError, error_map::map_db_err};

/// Search use case.
pub struct SearchUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> SearchUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// Full-text search across tasks.
    ///
    /// An empty or whitespace-only `query` returns an empty `Vec` without
    /// hitting the DB.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors as `AppError`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn search_tasks(
        &self,
        query: String,
        limit: Option<i64>,
    ) -> Result<Vec<SearchResult>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::search_tasks(&conn, &query, limit).map_err(map_db_err)
    }

    /// Full-text search across agent reports.
    ///
    /// An empty or whitespace-only `query` returns an empty `Vec` without
    /// hitting the DB.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors as `AppError`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn search_agent_reports(
        &self,
        query: String,
        limit: Option<i64>,
    ) -> Result<Vec<SearchResult>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::search_agent_reports(&conn, &query, limit).map_err(map_db_err)
    }

    /// Full-text search across all indexed entities (tasks + agent reports).
    ///
    /// Results are concatenated: tasks first, then agent reports. Within
    /// each slice results are ordered by FTS5 BM25 rank. Cross-slice rank
    /// interleaving is a follow-up (E4.x).
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors as `AppError`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn search_all(
        &self,
        query: String,
        limit_per_kind: Option<i64>,
    ) -> Result<Vec<SearchResult>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let mut results = repo::search_tasks(&conn, &query, limit_per_kind).map_err(map_db_err)?;
        let reports =
            repo::search_agent_reports(&conn, &query, limit_per_kind).map_err(map_db_err)?;
        results.extend(reports);
        Ok(results)
    }
}
