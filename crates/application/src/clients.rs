//! Connected-providers use case (round-21 Connected Providers refactor).
//!
//! Replaces the pre-round-21 "scan + JSON registry" path. The current
//! model:
//!
//! 1. `list_supported_providers` — static metadata for every provider
//!    in `catique_clients::all_providers()`.
//! 2. `list_providers` — every row in `connected_clients` (DB-backed).
//! 3. `add_provider(id)` — instantiate the provider, write a row, run
//!    the initial sync. Errors as `AppError::NotFound` for unknown ids
//!    and `AppError::Conflict` if the provider was already added.
//! 4. `remove_provider(id)` — call `provider.remove()` then delete the
//!    row. Idempotent.
//! 5. `bootstrap_first_launch_if_needed()` — on the very first app
//!    launch, scan every provider's `detect()` and seed
//!    `connected_clients` with the matches. Tracked via the
//!    `connected_providers_first_launch_done` settings KV slot.
//! 6. `sync_all_providers(bundle)` — used by the orchestrator;
//!    iterates connected providers and calls `provider.sync(&bundle)`
//!    per row. Returns `(succeeded_ids, failing_ids)`.
//!
//! The orchestrator itself (which subscribes to mutation events and
//! coalesces sync triggers) lives in
//! [`crate::connected_providers`]. This module is the synchronous use
//! case both the orchestrator AND the IPC handlers call.

use std::time::{SystemTime, UNIX_EPOCH};

use catique_clients::{all_providers, ClientProvider, ProviderError, RoleBundle};
use catique_domain::{ConnectedClient, ConnectionStatus, SupportedProvider};
use catique_infrastructure::clients::connected_clients::{self as repo, ConnectedClientRow};
use catique_infrastructure::db::pool::{acquire, Pool};
use catique_infrastructure::db::repositories::settings as settings_repo;

use crate::error::AppError;
use crate::error_map::map_db_err;

/// KV-store key tracking whether the first-launch bootstrap has run.
const FIRST_LAUNCH_KEY: &str = "connected_providers_first_launch_done";

/// Connected-providers use case. Borrows the application's pool the
/// same way every other use case does.
pub struct ConnectedProvidersUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> ConnectedProvidersUseCase<'a> {
    /// Construct around the application pool.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    // -----------------------------------------------------------------
    // Read-only IPC surface.
    // -----------------------------------------------------------------

    /// Static metadata for every provider in
    /// `catique_clients::all_providers()`. Used by the "Add provider"
    /// modal to render its picker.
    #[must_use]
    pub fn list_supported(&self) -> Vec<SupportedProvider> {
        all_providers()
            .iter()
            .map(|p| SupportedProvider {
                id: p.id().to_owned(),
                display_name: p.display_name().to_owned(),
                supports_agent_files: p.supports_agent_files(),
                supports_mcp: p.supports_mcp(),
            })
            .collect()
    }

    /// List every connected provider row — persisted state.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_providers(&self) -> Result<Vec<ConnectedClient>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_domain).collect())
    }

    // -----------------------------------------------------------------
    // Mutating IPC surface.
    // -----------------------------------------------------------------

    /// Add a provider by id. Performs the initial sync; if the sync
    /// fails the row still lands but with `connection_status = error`
    /// and `last_error` populated — the user can retry without
    /// re-clicking the modal.
    ///
    /// `bundle` is supplied by the caller (the orchestrator owns
    /// `RoleBundle` construction so the use-case layer doesn't have to
    /// import the resolver).
    ///
    /// # Errors
    ///
    /// - `AppError::NotFound` — `id` is not in
    ///   `catique_clients::all_providers()`.
    /// - `AppError::Conflict` — provider was already added.
    /// - Storage / provider errors as usual.
    pub async fn add_provider(
        &self,
        id: &str,
        bundle: &RoleBundle,
    ) -> Result<ConnectedClient, AppError> {
        let provider = find_provider(id)?;
        let now = now_unix_ms();

        // Insert the row first so a sync failure still leaves the
        // provider visible in the UI (with a red error chip and a
        // retry affordance).
        {
            let conn = acquire(self.pool).map_err(map_db_err)?;
            if repo::get_by_id(&conn, id).map_err(map_db_err)?.is_some() {
                return Err(AppError::Conflict {
                    entity: "connected_client".into(),
                    reason: format!("provider `{id}` is already added"),
                });
            }
            repo::insert(&conn, id, provider.display_name(), now).map_err(|e| {
                AppError::Conflict {
                    entity: "connected_client".into(),
                    reason: e.to_string(),
                }
            })?;
        }

        // Run the initial sync. Any provider error becomes a
        // `connection_status = error` row plus a typed AppError up to
        // the caller.
        match provider.sync(bundle).await {
            Ok(_report) => {
                let conn = acquire(self.pool).map_err(map_db_err)?;
                repo::mark_synced(&conn, id, now_unix_ms()).map_err(map_db_err)?;
            }
            Err(e) => {
                let conn = acquire(self.pool).map_err(map_db_err)?;
                let _ = repo::set_status(&conn, id, "error", Some(&e.to_string()), now_unix_ms());
                return Err(AppError::TransactionRolledBack {
                    reason: format!("initial sync failed: {e}"),
                });
            }
        }

        // Re-read the freshly-stamped row to return the canonical
        // shape to the IPC caller.
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::get_by_id(&conn, id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "connected_client".into(),
                id: id.to_owned(),
            })?;
        Ok(row_to_domain(row))
    }

    /// Remove a provider by id. Calls `provider.remove()` first; if
    /// that succeeds, deletes the row. Idempotent — calling twice is
    /// a no-op the second time.
    ///
    /// Round-21 says removal must be tolerant: even if the row has
    /// vanished from the DB (e.g. another window deleted it first),
    /// we still want the on-disk catique-managed files cleaned. The
    /// reverse is also true — if the on-disk remove fails (permission
    /// denied), we keep the DB row so the user can retry.
    ///
    /// # Errors
    ///
    /// - `AppError::NotFound` — provider id is not in
    ///   `all_providers()`. (DB-row absence is NOT an error; remove is
    ///   idempotent.)
    /// - `AppError::TransactionRolledBack` — provider remove failed.
    pub async fn remove_provider(&self, id: &str) -> Result<(), AppError> {
        let provider = find_provider(id)?;
        provider
            .remove()
            .await
            .map_err(|e| AppError::TransactionRolledBack {
                reason: format!("provider remove failed: {e}"),
            })?;

        let conn = acquire(self.pool).map_err(map_db_err)?;
        // Idempotent: ignore the bool — if the row was already gone
        // we still completed the conceptual operation.
        let _ = repo::delete(&conn, id).map_err(map_db_err)?;
        Ok(())
    }

    /// First-launch bootstrap. Runs `detect()` on every provider and
    /// inserts a row for each match. No-op on every subsequent boot.
    ///
    /// We do NOT run the initial sync here — at startup the resolver
    /// might not be ready, and we don't want to block the splash on
    /// I/O-heavy filesystem traversal. The first user-driven mutation
    /// will trigger a sync naturally via the orchestrator.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub async fn bootstrap_first_launch_if_needed(&self) -> Result<Vec<String>, AppError> {
        // Cheap KV-flag check.
        {
            let conn = acquire(self.pool).map_err(map_db_err)?;
            let flag = settings_repo::get_setting(&conn, FIRST_LAUNCH_KEY).map_err(map_db_err)?;
            if flag.as_deref() == Some("true") {
                return Ok(Vec::new());
            }
        }

        let mut detected_ids = Vec::new();
        let now = now_unix_ms();
        for provider in all_providers() {
            // detect() returns Ok(false) on permission errors / missing
            // homes, so we don't bail the whole bootstrap on a single
            // provider failure.
            let installed = provider.detect().await.unwrap_or(false);
            if !installed {
                continue;
            }
            // Idempotent insert via PK collision; existing rows from a
            // previous (incomplete) bootstrap are kept as-is.
            {
                let conn = acquire(self.pool).map_err(map_db_err)?;
                if repo::get_by_id(&conn, provider.id())
                    .map_err(map_db_err)?
                    .is_none()
                {
                    repo::insert(&conn, provider.id(), provider.display_name(), now)
                        .map_err(map_db_err)?;
                    detected_ids.push(provider.id().to_owned());
                }
            }
        }

        // Stamp the flag.
        let conn = acquire(self.pool).map_err(map_db_err)?;
        settings_repo::set_setting(&conn, FIRST_LAUNCH_KEY, "true").map_err(map_db_err)?;

        Ok(detected_ids)
    }

    /// Iterate every connected provider and call `provider.sync(bundle)`
    /// on each. Returns the list of provider ids whose sync failed.
    /// Per-row `connection_status` is updated as the iteration runs.
    ///
    /// # Errors
    ///
    /// Storage-layer errors short-circuit; provider errors do NOT
    /// (they are reported via the returned `failing_ids` vector).
    pub async fn sync_all_connected(&self, bundle: &RoleBundle) -> Result<SyncOutcome, AppError> {
        let connected: Vec<ConnectedClientRow> = {
            let conn = acquire(self.pool).map_err(map_db_err)?;
            repo::list_all(&conn).map_err(map_db_err)?
        };

        // Index providers by id. We re-instantiate each call so the
        // iteration is independent of the surrounding orchestrator
        // state.
        let providers: Vec<Box<dyn ClientProvider>> = all_providers();

        let mut succeeded = Vec::new();
        let mut failed: Vec<(String, String)> = Vec::new();

        for row in &connected {
            let Some(provider) = providers.iter().find(|p| p.id() == row.id) else {
                // Stale row referencing a dropped provider id. Mark
                // it as errored so the UI can offer a "remove" button.
                let conn = acquire(self.pool).map_err(map_db_err)?;
                let _ = repo::set_status(
                    &conn,
                    &row.id,
                    "error",
                    Some("provider id no longer in v1 set"),
                    now_unix_ms(),
                );
                failed.push((row.id.clone(), "provider id no longer in v1 set".into()));
                continue;
            };

            // Mark `syncing` while the sync is in flight.
            {
                let conn = acquire(self.pool).map_err(map_db_err)?;
                let _ = repo::set_status(&conn, &row.id, "syncing", None, now_unix_ms());
            }
            match provider.sync(bundle).await {
                Ok(_report) => {
                    let conn = acquire(self.pool).map_err(map_db_err)?;
                    let _ = repo::mark_synced(&conn, &row.id, now_unix_ms());
                    succeeded.push(row.id.clone());
                }
                Err(e) => {
                    let msg = e.to_string();
                    let conn = acquire(self.pool).map_err(map_db_err)?;
                    let _ = repo::set_status(&conn, &row.id, "error", Some(&msg), now_unix_ms());
                    failed.push((row.id.clone(), msg));
                }
            }
        }

        Ok(SyncOutcome { succeeded, failed })
    }
}

/// Result of [`ConnectedProvidersUseCase::sync_all_connected`].
#[derive(Debug, Clone, Default)]
pub struct SyncOutcome {
    pub succeeded: Vec<String>,
    pub failed: Vec<(String, String)>,
}

impl SyncOutcome {
    /// `true` when every connected provider's sync succeeded.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        self.failed.is_empty()
    }

    /// Just the ids of failed providers — the shape `SyncStatus`
    /// expects.
    #[must_use]
    pub fn failing_ids(&self) -> Vec<String> {
        self.failed.iter().map(|(id, _)| id.clone()).collect()
    }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

fn find_provider(id: &str) -> Result<Box<dyn ClientProvider>, AppError> {
    all_providers()
        .into_iter()
        .find(|p| p.id() == id)
        .ok_or_else(|| AppError::NotFound {
            entity: "supported_provider".into(),
            id: id.to_owned(),
        })
}

fn row_to_domain(row: ConnectedClientRow) -> ConnectedClient {
    ConnectedClient {
        id: row.id,
        display_name: row.display_name,
        connection_status: ConnectionStatus::parse(&row.connection_status),
        last_synced_at: row.last_synced_at,
        last_error: row.last_error,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Thin shim used by tests that don't want to import the providers
/// crate just to assert error types: re-exposes [`ProviderError`] via a
/// short alias so test fixtures can pattern-match without naming the
/// underlying crate.
#[allow(dead_code)]
pub(crate) type ProvErr = ProviderError;

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
    fn list_supported_returns_three_providers() {
        let pool = fresh_pool();
        let uc = ConnectedProvidersUseCase::new(&pool);
        let supported = uc.list_supported();
        let ids: Vec<&str> = supported.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["claude-code", "codex", "opencode"]);
        for p in &supported {
            assert!(p.supports_agent_files);
            assert!(p.supports_mcp);
        }
    }

    #[tokio::test]
    async fn add_unknown_provider_returns_not_found() {
        let pool = fresh_pool();
        let uc = ConnectedProvidersUseCase::new(&pool);
        let bundle = RoleBundle {
            roles: vec![],
            mcp: None,
        };
        let err = uc
            .add_provider("ghost-provider", &bundle)
            .await
            .expect_err("should not be found");
        match err {
            AppError::NotFound { entity, .. } => {
                assert_eq!(entity, "supported_provider");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn remove_unknown_provider_returns_not_found() {
        let pool = fresh_pool();
        let uc = ConnectedProvidersUseCase::new(&pool);
        match uc.remove_provider("ghost").await.expect_err("nf") {
            AppError::NotFound { entity, .. } => {
                assert_eq!(entity, "supported_provider");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn list_providers_empty_on_fresh_db() {
        let pool = fresh_pool();
        let uc = ConnectedProvidersUseCase::new(&pool);
        assert!(uc.list_providers().unwrap().is_empty());
    }
}
