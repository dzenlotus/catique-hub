//! Round-21 Connected Providers — sync orchestrator.
//!
//! One per-app-instance background task spawned at startup. Owns:
//!
//! 1. An `mpsc` channel of [`SyncTrigger`] notifications fired by IPC
//!    handlers on role / prompt mutations.
//! 2. A `broadcast` channel of [`SyncStatus`] updates for the
//!    application layer to forward as Tauri events.
//! 3. The pool the use case acquires connections from.
//!
//! Coalescing rules:
//!
//! * On the first message in the channel, drain every pending message
//!   before kicking off the sync round. A flurry of mutations during
//!   one user action (e.g. importing a YAML role bundle) results in
//!   one sync per provider, not N.
//! * `no debounce`: we never sleep between drain + sync. The maintainer
//!   ratified that timing-window debouncing is the wrong abstraction;
//!   coalescing within a single logical batch is fine.
//!
//! The orchestrator depends only on [`SyncTrigger`] and the
//! application-layer use case — it does NOT know about Tauri or the
//! IPC layer. The `api` crate is responsible for wiring the
//! `broadcast::Receiver<SyncStatus>` to its `events::emit` helper.

use std::sync::Arc;

use catique_clients::{
    McpEntry, ResolvedMcpTool, ResolvedPrompt, ResolvedRole, ResolvedSkill, RoleBundle,
};
use catique_domain::{SyncState, SyncStatus};
use catique_infrastructure::db::pool::{acquire, Pool};
use catique_infrastructure::db::repositories::{
    mcp_servers as servers_repo,
    mcp_tools::{self as tools_repo, McpToolRow, McpToolSourceRow},
    skills as skills_repo,
};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::{broadcast, mpsc, watch, Mutex};

use crate::clients::ConnectedProvidersUseCase;
use crate::error::AppError;
use crate::error_map::map_db_err;

/// Cause of a sync trigger. The orchestrator does not differentiate
/// between causes today — every variant resolves to a full
/// `sync_all_connected` round — but we keep the enum so we can fan out
/// per-cause logic later (e.g. prompt-only updates skipping role-only
/// providers).
#[derive(Debug, Clone, Copy)]
pub enum SyncTrigger {
    RoleMutation,
    PromptMutation,
    /// Synthetic "user just added a provider" trigger so the
    /// orchestrator runs a fresh sync after the initial one inside
    /// `add_provider` (covers the corner case where a mutation
    /// happened during the modal interaction).
    ProviderAdded,
}

/// Handle the application layer hands out so IPC handlers can fire
/// [`SyncTrigger`]s without depending on the orchestrator's internals.
#[derive(Clone)]
pub struct OrchestratorHandle {
    sender: mpsc::UnboundedSender<SyncTrigger>,
    /// Subscribed by the api layer to forward `sync:status_changed`.
    status_rx: watch::Receiver<SyncStatus>,
    status_tx_for_test: broadcast::Sender<SyncStatus>,
}

impl OrchestratorHandle {
    /// Fire a [`SyncTrigger`]. Best-effort: a closed channel (the
    /// orchestrator task has exited) is logged and swallowed so
    /// mutation IPC handlers don't fail user-visible operations
    /// because of a back-end-only issue.
    pub fn trigger(&self, t: SyncTrigger) {
        if let Err(e) = self.sender.send(t) {
            eprintln!("[catique-hub] sync trigger dropped: orchestrator exited ({e})");
        }
    }

    /// Read-only snapshot of the current sync status. Used by the
    /// `get_sync_status` IPC.
    #[must_use]
    pub fn snapshot_status(&self) -> SyncStatus {
        self.status_rx.borrow().clone()
    }

    /// Subscribe to status changes. The api layer uses this to forward
    /// `sync:status_changed` events to the frontend.
    #[must_use]
    pub fn subscribe_status(&self) -> broadcast::Receiver<SyncStatus> {
        self.status_tx_for_test.subscribe()
    }
}

/// Spawn the orchestrator task on the supplied Tokio runtime. Returns
/// the handle the api crate stashes in `AppState`.
///
/// The task lives for the duration of the runtime — there is no
/// graceful-stop path because we want the orchestrator to keep running
/// even during app shutdown (the final mutation should still get
/// synced before the runtime is torn down). The task ends naturally
/// when the mpsc sender is dropped.
#[must_use]
pub fn spawn_orchestrator(pool: Pool) -> OrchestratorHandle {
    let (sender, mut receiver) = mpsc::unbounded_channel::<SyncTrigger>();
    let (status_tx, status_rx) = watch::channel::<SyncStatus>(SyncStatus::default());
    let (broadcast_tx, _) = broadcast::channel::<SyncStatus>(64);

    let pool_for_task = pool;
    let broadcast_for_task = broadcast_tx.clone();

    // Wrap the watch sender + broadcast in an Arc<Mutex<>> so the loop
    // can update both atomically.
    let status_tx = Arc::new(Mutex::new(status_tx));

    tokio::spawn(async move {
        while let Some(first) = receiver.recv().await {
            // Coalesce: drain everything pending without yielding so
            // a single batch becomes one sync round.
            drain_pending(&mut receiver);
            // Mark `Syncing`.
            let syncing = SyncStatus {
                state: SyncState::Syncing,
                failing_providers: Vec::new(),
            };
            publish_status(&status_tx, &broadcast_for_task, &syncing).await;

            // Build the bundle (best-effort) and run the sync.
            let bundle = match build_bundle(&pool_for_task) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("[catique-hub] orchestrator: bundle build failed: {e}");
                    let err_state = SyncStatus {
                        state: SyncState::Error,
                        failing_providers: vec!["<bundle>".into()],
                    };
                    publish_status(&status_tx, &broadcast_for_task, &err_state).await;
                    continue;
                }
            };
            // `first` is consumed once coalesced — bound to `_` only
            // to anchor the per-cause routing hook the brief flagged
            // for a future iteration.
            let _ = first;

            let uc = ConnectedProvidersUseCase::new(&pool_for_task);
            match uc.sync_all_connected(&bundle).await {
                Ok(outcome) if outcome.is_clean() => {
                    publish_status(
                        &status_tx,
                        &broadcast_for_task,
                        &SyncStatus {
                            state: SyncState::Idle,
                            failing_providers: Vec::new(),
                        },
                    )
                    .await;
                }
                Ok(outcome) => {
                    publish_status(
                        &status_tx,
                        &broadcast_for_task,
                        &SyncStatus {
                            state: SyncState::Error,
                            failing_providers: outcome.failing_ids(),
                        },
                    )
                    .await;
                }
                Err(e) => {
                    eprintln!("[catique-hub] orchestrator: sync_all_connected failed: {e}");
                    publish_status(
                        &status_tx,
                        &broadcast_for_task,
                        &SyncStatus {
                            state: SyncState::Error,
                            failing_providers: vec!["<sync>".into()],
                        },
                    )
                    .await;
                }
            }
        }
    });

    OrchestratorHandle {
        sender,
        status_rx,
        status_tx_for_test: broadcast_tx,
    }
}

async fn publish_status(
    watch_tx: &Arc<Mutex<watch::Sender<SyncStatus>>>,
    broadcast_tx: &broadcast::Sender<SyncStatus>,
    status: &SyncStatus,
) {
    {
        let guard = watch_tx.lock().await;
        // watch::Sender::send_replace is the right primitive — it
        // ignores "no receiver" because the api layer's reader is
        // always present (held in AppState).
        let _ = guard.send(status.clone());
    }
    let _ = broadcast_tx.send(status.clone());
}

fn drain_pending(rx: &mut mpsc::UnboundedReceiver<SyncTrigger>) {
    while let Ok(_t) = rx.try_recv() {
        // intentionally drop — the trigger has already been
        // collapsed into the in-flight sync round.
    }
}

/// Build the [`RoleBundle`] the orchestrator hands to providers.
///
/// Today this is a thin SQL fetch — every role with its prompts in
/// resolver order. The full inheritance walk (`board_prompts` /
/// `column_prompts` / `space_prompts` cascading into per-task
/// resolution) is NOT needed here: providers project Catique's *role
/// catalog*, not per-task resolved bundles. A future iteration may
/// expand the per-role prompt set to include the inheritance closure;
/// the trait surface accepts whatever resolved shape we hand it.
fn build_bundle(pool: &Pool) -> Result<RoleBundle, AppError> {
    let conn = acquire(pool).map_err(map_db_err)?;
    // Resolve `<app_data_dir>/skills/` once up front so per-skill
    // attachment paths share the same root. Falls back to a relative
    // `./skills/` segment when the platform's data-local-dir is
    // unavailable — the renderer ships whatever path we hand it and
    // a relative segment is more debuggable than an empty string.
    let skills_root = catique_infrastructure::paths::app_data_dir()
        .map_or_else(|_| PathBuf::from("skills"), |p| p.join("skills"));
    let mut stmt = conn
        .prepare(
            "SELECT id, name, content FROM roles \
             WHERE COALESCE(is_system, 0) = 0 \
             ORDER BY name ASC",
        )
        .map_err(|e| AppError::TransactionRolledBack {
            reason: format!("orchestrator role query: {e}"),
        })?;
    let role_rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| AppError::TransactionRolledBack {
            reason: format!("orchestrator role query: {e}"),
        })?
        .filter_map(Result::ok)
        .collect();

    // Cache server-id → server-name lookups across all roles in the
    // bundle. The bundle build is one transaction; we reuse hits.
    let mut server_name_cache: HashMap<String, String> = HashMap::new();

    let mut roles = Vec::with_capacity(role_rows.len());
    for (id, name, content) in role_rows {
        let mut pstmt = conn
            .prepare(
                "SELECT p.id, p.name, p.content \
                 FROM role_prompts rp \
                 JOIN prompts p ON p.id = rp.prompt_id \
                 WHERE rp.role_id = ?1 \
                 ORDER BY rp.position ASC",
            )
            .map_err(|e| AppError::TransactionRolledBack {
                reason: format!("orchestrator prompt query: {e}"),
            })?;
        let prompts: Vec<ResolvedPrompt> = pstmt
            .query_map([&id], |row| {
                Ok(ResolvedPrompt {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    content: row.get(2)?,
                })
            })
            .map_err(|e| AppError::TransactionRolledBack {
                reason: format!("orchestrator prompt query: {e}"),
            })?
            .filter_map(Result::ok)
            .collect();

        // ADR-0008: every MCP tool attached to the role becomes a
        // `<mcp-tool>` block in the rendered file. We pre-resolve the
        // qualified name here so providers don't need DB access.
        let tool_rows =
            tools_repo::list_for_role(&conn, &id).map_err(|e| AppError::TransactionRolledBack {
                reason: format!("orchestrator mcp_tool query for role {id}: {e}"),
            })?;
        let mut mcp_tools = Vec::with_capacity(tool_rows.len());
        for row in tool_rows {
            let qualified_name = qualified_tool_name(&conn, &row, &mut server_name_cache)?;
            mcp_tools.push(ResolvedMcpTool {
                qualified_name,
                description: row.description,
                input_schema_json: row.schema_json,
            });
        }

        // SKILL-S11: every skill attached to the role becomes a
        // `<skill>` block in the rendered file. The skill row itself
        // (name + description) is sourced from the existing `skills`
        // table; per-skill attachments are resolved in
        // `resolve_skill_attachments` against the
        // `<app_data_dir>/skills/<skill_id>/` layout SKILL-S10 commits.
        let skill_rows = skills_repo::list_for_role(&conn, &id).map_err(|e| {
            AppError::TransactionRolledBack {
                reason: format!("orchestrator skill query for role {id}: {e}"),
            }
        })?;
        let mut skills = Vec::with_capacity(skill_rows.len());
        for srow in skill_rows {
            let attachments = resolve_skill_attachments(&conn, &srow.id, &skills_root)?;
            skills.push(ResolvedSkill {
                id: srow.id,
                name: srow.name,
                description: srow.description,
                attachments,
            });
        }

        roles.push(ResolvedRole {
            slug: slugify(&name, &id),
            id,
            name,
            content,
            prompts,
            mcp_tools,
            skills,
        });
    }

    Ok(RoleBundle {
        roles,
        mcp: Some(default_mcp_entry()),
    })
}

/// Resolve every attachment row for a single skill into the
/// `ResolvedSkillAttachment` shape the renderer consumes (SKILL-S11).
///
/// Paired with SKILL-S10 which lands the `skill_attachments` schema +
/// repository (`crates/infrastructure/src/db/repositories/skill_attachments.rs`).
/// Until that commit merges this resolver returns an empty `Vec` —
/// `build_bundle` still emits the `<skill>` block (description alone is
/// useful to the agent), and the integration test exercises the
/// renderer by constructing `RoleBundle` instances directly.
///
/// Post-merge cherry-pick wires the query:
///
/// ```text
/// let rows = skill_attachments::list_for_skill(conn, skill_id)?;
/// // map each row → ResolvedSkillAttachment with
/// // absolute_path = skills_root.join(skill_id).join(storage_path)
/// ```
///
/// `_skills_root` and `_conn` are kept on the signature so the
/// cherry-pick is a body-only edit; clippy is silenced via the leading
/// underscores.
#[allow(clippy::unnecessary_wraps)]
fn resolve_skill_attachments(
    _conn: &rusqlite::Connection,
    _skill_id: &str,
    _skills_root: &std::path::Path,
) -> Result<Vec<catique_clients::ResolvedSkillAttachment>, AppError> {
    Ok(Vec::new())
}

/// Resolve the qualified name an `<mcp-tool>` block uses for an
/// `mcp_tools` row (ADR-0005 round-21 amendment).
///
/// * `Manual` rows ship as `mcp_tool.name` — there is no upstream
///   server, so no qualifier prefix.
/// * `Upstream` rows ship as `{server.name}.{upstream_name}` — matches
///   what Catique's `tools/list` advertises to external agents.
///
/// Defence in depth: if an `Upstream` row is missing `server_id`,
/// `upstream_name`, or the server row itself has been deleted, we
/// fall back to the local `name` column. The row would not normally
/// reach this path in that state (introspection clears `server_id` on
/// cascade delete) but the fallback keeps the role file renderable.
fn qualified_tool_name(
    conn: &rusqlite::Connection,
    row: &McpToolRow,
    cache: &mut HashMap<String, String>,
) -> Result<String, AppError> {
    match row.source {
        McpToolSourceRow::Manual => Ok(row.name.clone()),
        McpToolSourceRow::Upstream => {
            let (Some(server_id), Some(upstream_name)) =
                (row.server_id.as_ref(), row.upstream_name.as_ref())
            else {
                // Corrupt upstream row — surface the local name so
                // the rendered file remains valid XML.
                return Ok(row.name.clone());
            };
            let server_name = if let Some(cached) = cache.get(server_id) {
                cached.clone()
            } else {
                let server = servers_repo::get_by_id(conn, server_id).map_err(|e| {
                    AppError::TransactionRolledBack {
                        reason: format!("orchestrator mcp_server lookup `{server_id}`: {e}"),
                    }
                })?;
                match server {
                    Some(s) => {
                        cache.insert(server_id.clone(), s.name.clone());
                        s.name
                    }
                    None => {
                        // Server vanished — fall back to local name.
                        return Ok(row.name.clone());
                    }
                }
            };
            Ok(format!("{server_name}.{upstream_name}"))
        }
    }
}

/// Stable kebab-case slug derived from the role name. Falls back to
/// the role id if the name has no ASCII alphanumerics (defence in
/// depth — filenames must round-trip across providers).
fn slugify(name: &str, fallback_id: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            for lc in c.to_lowercase() {
                out.push(lc);
            }
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        format!("role-{fallback_id}")
    } else {
        out
    }
}

/// Default catique-hub MCP entry. We point at the embedded sidecar
/// process — the same one that backs the existing MCP bridge. A
/// future iteration can read this from a settings KV slot so users on
/// non-default install paths can override.
fn default_mcp_entry() -> McpEntry {
    McpEntry {
        command: "catique-hub-mcp".into(),
        args: vec!["--stdio".into()],
        env: vec![],
    }
}

/// Public for tests in sibling crates AND for the
/// `add_provider` IPC handler which needs to construct a fresh
/// [`RoleBundle`] before delegating to the use case.
///
/// # Errors
///
/// Forwards storage-layer errors from the role/prompt SQL fetch.
pub fn build_bundle_for_test(pool: &Pool) -> Result<RoleBundle, AppError> {
    build_bundle(pool)
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
    fn slugify_handles_typical_names() {
        assert_eq!(slugify("Code Reviewer", "id-1"), "code-reviewer");
        assert_eq!(
            slugify("Frontend // Engineer!", "id-2"),
            "frontend-engineer"
        );
        assert_eq!(slugify("Über Backend", "id-3"), "ber-backend");
        assert_eq!(slugify("   ", "id-4"), "role-id-4");
        assert_eq!(slugify("R2D2", "id-5"), "r2d2");
    }

    #[tokio::test]
    async fn build_bundle_skips_system_roles() {
        let pool = fresh_pool();
        // Migration 004 seeds `maintainer-system` and
        // `dirizher-system` rows with `is_system = 1`. Insert one
        // user role too.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, color, created_at, updated_at) \
                 VALUES ('user-role', 'Reviewer', 'review code', NULL, 0, 0)",
                [],
            )
            .unwrap();
        }
        let bundle = build_bundle(&pool).unwrap();
        let ids: Vec<&str> = bundle.roles.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["user-role"]);
        assert_eq!(bundle.roles[0].slug, "reviewer");
        assert!(bundle.mcp.is_some());
    }

    #[tokio::test]
    async fn orchestrator_publishes_status_after_trigger() {
        let pool = fresh_pool();
        let handle = spawn_orchestrator(pool);
        let mut rx = handle.subscribe_status();
        handle.trigger(SyncTrigger::RoleMutation);

        // Expect a status flow: idle → syncing → idle (no providers
        // connected so the loop is a no-op).
        let mut saw_syncing = false;
        let mut saw_idle = false;
        for _ in 0..6 {
            match tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await {
                Ok(Ok(s)) => {
                    if s.state == SyncState::Syncing {
                        saw_syncing = true;
                    }
                    if s.state == SyncState::Idle && saw_syncing {
                        saw_idle = true;
                        break;
                    }
                }
                _ => break,
            }
        }
        assert!(saw_syncing, "orchestrator should publish a Syncing state");
        assert!(saw_idle, "orchestrator should publish a final Idle state");
    }
}
