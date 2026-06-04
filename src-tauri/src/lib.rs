//! Catique HUB — Tauri 2.x shell entry point.
//!
//! Wave-E2.4 (Olga, 2026-04-28): registers the full 8-entity CRUD
//! pipeline. Per NFR §3.1 ("panic semantics"), startup-phase errors
//! **do not panic**: we log and return cleanly so the dev launcher can
//! show a useful message.
//!
//! ADR-0002 spike (ctq-56): wires the sidecar lifecycle — spawn in
//! `setup`, stop on `ExitRequested`, exposes three IPC commands.

// Lints configured via [lints.clippy] in Cargo.toml.

use std::path::{Path, PathBuf};
use std::time::Duration;

use catique_api::{handlers, AppState};
use catique_infrastructure::db::{open_pool, run_pending};
use catique_infrastructure::paths::db_path;
use tauri::{Manager, RunEvent};

/// Entrypoint invoked by `main.rs` (and on mobile by
/// `tauri::mobile_entry_point`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::too_many_lines)]
pub fn run() {
    let sidecar_dir = resolve_sidecar_dir();
    let state = match init_state(sidecar_dir) {
        Ok(state) => state,
        Err(reason) => {
            // NFR §3.1: don't panic on startup-phase failures. Log and
            // return cleanly — the dev runner / packaged app launcher
            // surfaces a "DB unavailable" badge to the user.
            eprintln!("[catique-hub] startup aborted: {reason}");
            return;
        }
    };

    let app = match tauri::Builder::default()
        // Round-21 (maintainer feedback): a fresh `tauri dev` rebuild
        // would happily open a new OS window every iteration while
        // older instances still owned the SQLite WAL — multiple
        // windows accumulated and confused the user. The single-
        // instance plugin short-circuits the second launch by
        // forwarding to the running process; the callback below
        // un-minimises and focuses the existing main window so a
        // double-click on the dock icon (or a parallel `tauri dev`)
        // surfaces the running instance instead of spawning a new
        // shell.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.show();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            // E2.5 (Katya): publish the AppHandle into AppState so
            // `catique_api::events::emit` can broadcast realtime
            // events from every IPC handler. `OnceCell::set` is
            // idempotent — see `AppState::set_app_handle`.
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            state.set_app_handle(handle);

            // Round-21 Connected Providers: spawn the orchestrator
            // task and stash its handle in AppState. The handle is
            // cheap (Arc-backed channels) and is read by both the
            // `add_provider` IPC (to fire a post-add trigger) and the
            // `get_sync_status` IPC (to read the watch channel).
            //
            // We spawn the orchestrator BEFORE the bootstrap so the
            // first-launch detected providers have a sync target
            // ready when their first user-driven mutation lands.
            //
            // `spawn_orchestrator` internally calls `tokio::spawn`,
            // which requires an active tokio runtime context. Tauri's
            // `setup` runs on the main thread BEFORE the runtime
            // context is entered there, so a bare call panics with
            // "there is no reactor running" — the panic crosses the
            // Cocoa FFI boundary and surfaces as `panic_cannot_unwind`
            // in `tao::app_delegate::did_finish_launching` (round-21
            // crash report). `block_on` enters the runtime context so
            // the inner `tokio::spawn` lands cleanly.
            let orchestrator = tauri::async_runtime::block_on(async {
                catique_application::connected_providers::spawn_orchestrator(state.pool.clone())
            });
            // Hook the orchestrator's status broadcast to the Tauri
            // event bus so the frontend gets `sync:status_changed`.
            let mut status_rx = orchestrator.subscribe_status();
            let app_for_events = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Emitter;
                while let Ok(status) = status_rx.recv().await {
                    if let Err(e) =
                        app_for_events.emit(catique_api::events::SYNC_STATUS_CHANGED, &status)
                    {
                        eprintln!("[catique-hub] sync:status_changed emit failed: {e}");
                    }
                }
            });
            // Clone a handle for the change_events tail (spawned below)
            // so role mutations made by the out-of-process
            // `catique-hub-mcp` binary still fire a provider re-sync.
            // Must clone BEFORE the handle moves into AppState.
            let orch_for_tail = orchestrator.clone();
            state.set_orchestrator(orchestrator);

            // First-launch zero-state bootstrap. The KV flag in the
            // settings table guarantees this runs at most once.
            // After that, refresh the catique-hub MCP entry across
            // every connected provider so the recorded paths track
            // the current location of the .app — users who moved the
            // bundle between launches still get working MCP wiring
            // without manual config surgery.
            //
            // Skipped entirely in debug builds: a developer running
            // `pnpm tauri:dev` alongside an installed `Catique HUB.app`
            // would otherwise see 150+ MCP tools twice inside every
            // Claude Code / Codex session (once from the prod
            // `catique-hub` server, once from the dev `catique-hub-dev`
            // server). The dev binary keeps the UI's Connected
            // Providers page available so the user can opt-in manually
            // if they want to exercise the sync flow.
            #[cfg(not(debug_assertions))]
            {
                let bootstrap_pool = state.pool.clone();
                tauri::async_runtime::spawn(async move {
                    let uc = catique_application::clients::ConnectedProvidersUseCase::new(
                        &bootstrap_pool,
                    );
                    match uc.bootstrap_first_launch_if_needed().await {
                        Ok(ids) if !ids.is_empty() => {
                            eprintln!("[catique-hub] first-launch detected providers: {ids:?}");
                        }
                        Ok(_) => {}
                        Err(e) => {
                            eprintln!("[catique-hub] first-launch bootstrap failed: {e}");
                        }
                    }
                    uc.refresh_catique_mcp_in_all_connected().await;
                });
            }

            // W1 (catique-hub-mcp standalone binary, 2026-05-14):
            //
            // Release builds publish a single env var, `CATIQUE_MCP_BIN`,
            // pointing at the bundled Rust MCP server. External MCP
            // clients (Claude Desktop, Claude Code, Codex) spawn this
            // binary directly via the `command` entry that
            // `default_mcp_entry` writes into their configs. The Tauri
            // shell's in-process `SidecarManager` is no longer used for
            // external MCP traffic in release — Catique HUB's own
            // internal flows talk to use cases directly, and the
            // `mcp_bridge` is only installed in debug to keep the
            // legacy sidecar path testable while it lingers.
            //
            // Debug builds resolve a workspace-relative path so
            // `pnpm tauri dev` picks up freshly-built binaries from
            // `target/debug/`. The path is best-effort: if the binary
            // hasn't been built yet, external clients will fail to
            // launch the MCP server — the user is expected to run
            // `cargo build --bin catique-hub-mcp` at least once.
            let mcp_bin = if cfg!(debug_assertions) {
                let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                manifest.parent().map_or_else(
                    || PathBuf::from("catique-hub-mcp"),
                    |root| root.join("target").join("debug").join("catique-hub-mcp"),
                )
            } else {
                // Release: Tauri's `externalBin` ships the binary
                // alongside the .app's main executable. On macOS that
                // is `Contents/MacOS/`, on Linux it sits next to the
                // launcher, on Windows it's the same install dir.
                // Resolve relative to the current binary so the
                // catique-hub MCP entry tracks the .app wherever the
                // user moved it.
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
                    .map_or_else(
                        || PathBuf::from("catique-hub-mcp"),
                        |d| d.join("catique-hub-mcp"),
                    )
            };
            std::env::set_var("CATIQUE_MCP_BIN", &mcp_bin);
            eprintln!("[catique-hub] CATIQUE_MCP_BIN = {}", mcp_bin.display());

            // ctq-cross-process-bus: tail the `change_events` table
            // and re-emit each row as the matching Tauri event. The
            // standalone `catique-hub-mcp` binary commits to the same
            // SQLite file from another process — without this bridge
            // the UI would only see those mutations after a reload.
            //
            // Tick is 50 ms (well under the human flicker threshold);
            // each tick does one indexed SELECT against `seq`. The
            // tail seeds `last_seen` from the current max so a fresh
            // shell start does not re-emit history accumulated while
            // no listener was present.
            //
            // Purge runs roughly once a minute (60_000 ms / 50 ms =
            // 1200 ticks); rows older than 60 s are GC'd.
            {
                use catique_infrastructure::db::event_log;
                let pool_for_tail = state.pool.clone();
                let app_for_tail = app.handle().clone();
                // Optional verbose tracing — set `CATIQUE_EVENTLOG_DEBUG=1`
                // when investigating cross-process UI-sync regressions
                // (catique-3). When enabled, every successful emit is
                // logged with seq + name; without it, only errors and
                // the seed/health-check lines surface.
                let event_log_debug =
                    std::env::var("CATIQUE_EVENTLOG_DEBUG").is_ok_and(|v| v == "1");
                tauri::async_runtime::spawn(async move {
                    use tauri::Emitter;
                    let mut last_seen: i64 = {
                        let pool_clone = pool_for_tail.clone();
                        match tokio::task::spawn_blocking(move || -> Result<i64, String> {
                            let conn = pool_clone.get().map_err(|e| e.to_string())?;
                            event_log::current_max_seq(&conn).map_err(|e| e.to_string())
                        })
                        .await
                        {
                            Ok(Ok(v)) => v,
                            Ok(Err(e)) => {
                                eprintln!("[catique-hub] event_log seed failed: {e}");
                                0
                            }
                            Err(e) => {
                                eprintln!("[catique-hub] event_log seed join failed: {e}");
                                0
                            }
                        }
                    };
                    eprintln!(
                        "[catique-hub] event_log tail started: seed_last_seen={last_seen} debug={event_log_debug}"
                    );
                    let mut purge_tick: u32 = 0;
                    let mut idle_ticks: u32 = 0;
                    loop {
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        let pool_clone = pool_for_tail.clone();
                        let last = last_seen;
                        let rows = match tokio::task::spawn_blocking(
                            move || -> Result<Vec<event_log::ChangeEvent>, String> {
                                let conn = pool_clone.get().map_err(|e| e.to_string())?;
                                event_log::tail(&conn, last, 200).map_err(|e| e.to_string())
                            },
                        )
                        .await
                        {
                            Ok(Ok(v)) => v,
                            Ok(Err(e)) => {
                                eprintln!("[catique-hub] event_log tail failed: {e}");
                                Vec::new()
                            }
                            Err(e) => {
                                eprintln!("[catique-hub] event_log tail join failed: {e}");
                                Vec::new()
                            }
                        };
                        if rows.is_empty() {
                            idle_ticks = idle_ticks.wrapping_add(1);
                        } else {
                            idle_ticks = 0;
                            eprintln!(
                                "[catique-hub] event_log tail: picked up {} row(s), last_seen={}",
                                rows.len(),
                                last_seen
                            );
                        }
                        for row in rows {
                            match app_for_tail.emit(&row.name, &row.payload) {
                                Ok(()) => {
                                    if event_log_debug {
                                        eprintln!(
                                            "[catique-hub] event_log emit ok: seq={} name={} payload={}",
                                            row.seq, row.name, row.payload
                                        );
                                    }
                                }
                                Err(e) => {
                                    eprintln!(
                                        "[catique-hub] event_log emit({}) failed: {e}",
                                        row.name
                                    );
                                }
                            }
                            // Cross-process agent-file reconciliation:
                            // a role mutation committed by the standalone
                            // MCP binary lands here as a `role:*` row —
                            // fire a re-sync so the deleted role's
                            // `catique-<slug>` file is pruned from every
                            // provider's agents dir.
                            if let Some(t) =
                                catique_application::connected_providers::sync_trigger_for_event(
                                    &row.name,
                                )
                            {
                                orch_for_tail.trigger(t);
                            }
                            last_seen = row.seq;
                        }
                        // Health heartbeat every ~30 s of pure idleness so a
                        // silent listener vs. a wedged tail are easy to tell
                        // apart in logs. 30_000 / 50 = 600 ticks.
                        if idle_ticks > 0 && idle_ticks % 600 == 0 {
                            eprintln!(
                                "[catique-hub] event_log tail idle: 30s no new rows, last_seen={last_seen}"
                            );
                        }
                        purge_tick = purge_tick.wrapping_add(1);
                        if purge_tick % 1200 == 0 {
                            let pool_clone = pool_for_tail.clone();
                            let _ = tokio::task::spawn_blocking(move || {
                                let conn = match pool_clone.get() {
                                    Ok(c) => c,
                                    Err(e) => {
                                        eprintln!(
                                            "[catique-hub] event_log purge acquire failed: {e}"
                                        );
                                        return;
                                    }
                                };
                                // refactor-v3 D-D: bump retention to 90
                                // days. `PURGE_MAX_AGE_MS` is the single
                                // source of truth — keep this call site
                                // in lockstep with `event_log` rather
                                // than hard-coding the duration.
                                if let Err(e) = event_log::purge_older_than(
                                    &conn,
                                    event_log::PURGE_MAX_AGE_MS,
                                ) {
                                    eprintln!("[catique-hub] event_log purge failed: {e}");
                                }
                            })
                            .await;
                        }
                    }
                });
            }

            // Spin up the Node MCP sidecar and register the supervisor
            // bridge. Runs in both dev and release: the sidecar is now
            // bundled under the .app's resource dir (tauri.conf.json
            // `resources`) and `resolve_node_bin` locates a Node runtime
            // even under Finder's minimal PATH. The manual start/restart
            // controls in the UI depend on the bridge being installed, so
            // this must not be gated behind `debug_assertions`.
            {
                let sidecar_dir = state.sidecar_dir.clone();
                let node_bin = resolve_node_bin();
                std::env::set_var("CATIQUE_SIDECAR_INDEX_JS", sidecar_dir.join("index.js"));
                std::env::set_var("CATIQUE_NODE_BIN", &node_bin);
                eprintln!(
                    "[catique-hub] sidecar dir={} node={}",
                    sidecar_dir.display(),
                    node_bin
                );
                let sidecar_mgr = state.sidecar.clone();
                let pool = state.pool.clone();
                let bridge_orchestrator = state.orchestrator.get().cloned();
                tauri::async_runtime::spawn(async move {
                    catique_api::mcp_bridge::install(&sidecar_mgr, pool, bridge_orchestrator).await;
                    match sidecar_mgr.start(&sidecar_dir).await {
                        Ok(pid) => eprintln!("[catique-hub] sidecar started, pid={pid}"),
                        Err(e) => {
                            eprintln!("[catique-hub] sidecar spawn failed (optional): {e}");
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ---------------- activity log (refactor v3 / Wave 5 + D-D) ----------------
            handlers::events::list_recent_events,
            handlers::events::list_recent_events_by_scope,
            // ---------------- spaces (E2.4) ----------------
            handlers::spaces::create_space,
            handlers::spaces::delete_space,
            handlers::spaces::get_space,
            handlers::spaces::list_spaces,
            handlers::spaces::update_space,
            // ---------------- space_prompts + space_skills/mcp_tools (ctq-99 + ctq-120) ----------------
            handlers::spaces::add_space_prompt,
            handlers::spaces::list_space_prompts,
            handlers::spaces::remove_space_prompt,
            handlers::spaces::set_space_mcp_tools,
            handlers::spaces::set_space_prompts,
            handlers::spaces::set_space_skills,
            // ---------------- spaces.workflow_graph_json (ctq-113, Phase 5 stub) ----------------
            handlers::spaces::get_workflow_graph,
            handlers::spaces::set_workflow_graph,
            // ---------------- boards (E2.1 + E2.4 + ctq-101 + ctq-108 + ctq-120 + D-F) ----------------
            handlers::boards::clear_recent_boards,
            handlers::boards::create_board,
            handlers::boards::delete_board,
            handlers::boards::get_board,
            handlers::boards::list_boards,
            handlers::boards::list_recent_boards,
            handlers::boards::set_board_mcp_tools,
            handlers::boards::set_board_owner,
            handlers::boards::set_board_prompts,
            handlers::boards::set_board_skills,
            handlers::boards::track_board_visit,
            handlers::boards::update_board,
            // ---------------- data export / import ----------------
            handlers::data::export_database,
            handlers::data::import_database,
            // ---------------- columns (E2.4 + ctq-108 + ctq-120) ----------------
            handlers::columns::create_column,
            handlers::columns::delete_column,
            handlers::columns::get_column,
            handlers::columns::list_columns,
            handlers::columns::set_column_mcp_tools,
            handlers::columns::set_column_prompts,
            handlers::columns::set_column_skills,
            handlers::columns::update_column,
            // ---------------- tasks (E2.4) ----------------
            handlers::tasks::add_task_prompt,
            handlers::tasks::clear_task_mcp_tool_override_v2,
            handlers::tasks::clear_task_prompt_override,
            handlers::tasks::clear_task_prompt_override_v2,
            handlers::tasks::clear_task_skill_override_v2,
            handlers::tasks::create_task,
            handlers::tasks::delete_task,
            handlers::tasks::get_step_log,
            handlers::tasks::get_task,
            handlers::tasks::get_task_bundle,
            handlers::tasks::get_task_rating,
            handlers::tasks::list_task_prompts,
            handlers::tasks::list_tasks,
            handlers::tasks::log_step,
            handlers::tasks::move_task,
            handlers::tasks::rate_task,
            handlers::tasks::remove_task_prompt,
            handlers::tasks::route_task_to_board,
            handlers::tasks::run_task_agent,
            handlers::tasks::set_task_mcp_tool_override_v2,
            handlers::tasks::set_task_prompt_override,
            handlers::tasks::set_task_prompt_override_v2,
            handlers::tasks::set_task_skill_override_v2,
            handlers::tasks::update_task,
            // ---------------- prompts (E2.4 + D-C) ----------------
            handlers::prompts::add_board_prompt,
            handlers::prompts::add_column_prompt,
            handlers::prompts::create_prompt,
            handlers::prompts::delete_prompt,
            handlers::prompts::get_prompt,
            handlers::prompts::get_prompt_version,
            handlers::prompts::list_prompts,
            handlers::prompts::list_prompt_versions,
            handlers::prompts::remove_board_prompt,
            handlers::prompts::remove_column_prompt,
            handlers::prompts::recompute_prompt_token_count,
            handlers::prompts::revert_prompt_to_version,
            handlers::prompts::update_prompt,
            // ---------------- roles (E2.4 + ctq-108 + D-C) ----------------
            handlers::roles::add_role_mcp_tool,
            handlers::roles::add_role_prompt,
            handlers::roles::add_role_skill,
            handlers::roles::create_role,
            handlers::roles::delete_role,
            handlers::roles::get_role,
            handlers::roles::get_role_version,
            handlers::roles::list_roles,
            handlers::roles::list_role_versions,
            handlers::roles::list_role_prompts,
            handlers::roles::remove_role_mcp_tool,
            handlers::roles::remove_role_prompt,
            handlers::roles::remove_role_skill,
            handlers::roles::revert_role_to_version,
            handlers::roles::set_role_prompts,
            handlers::roles::update_role,
            // ---------------- role notes (ctq-137 / MEM-S1) ----------------
            handlers::role_notes::add_role_note,
            handlers::role_notes::delete_role_note,
            handlers::role_notes::get_role_note,
            handlers::role_notes::list_role_note_tags,
            handlers::role_notes::list_role_notes,
            handlers::role_notes::recall_role_notes,
            handlers::role_notes::update_role_note,
            // ---------------- skills (E2.x + ctq-117 + ctq-127 + SKILL-S10 + SKILL-V2-A) ----------------
            handlers::skills::add_skill_file_attachment,
            handlers::skills::add_skill_git_attachment,
            handlers::skills::add_skill_step,
            handlers::skills::add_task_skill,
            handlers::skills::create_skill,
            handlers::skills::delete_skill,
            handlers::skills::delete_skill_step,
            handlers::skills::export_skill_as_markdown,
            handlers::skills::get_skill,
            handlers::skills::import_skill_from_url,
            handlers::skills::list_role_skills,
            handlers::skills::list_skill_attachments,
            handlers::skills::list_skill_steps,
            handlers::skills::list_skills,
            handlers::skills::list_task_skills,
            handlers::skills::remove_skill_attachment,
            handlers::skills::remove_task_skill,
            handlers::skills::reorder_skill_steps,
            handlers::skills::update_skill,
            handlers::skills::update_skill_step,
            // ---------------- mcp tools (E2.x + ctq-117 + ctq-127) ----------------
            handlers::mcp_tools::add_task_mcp_tool,
            handlers::mcp_tools::create_mcp_tool,
            handlers::mcp_tools::delete_mcp_tool,
            handlers::mcp_tools::get_mcp_tool,
            handlers::mcp_tools::list_mcp_tools,
            handlers::mcp_tools::list_role_mcp_tools,
            handlers::mcp_tools::list_task_mcp_tools,
            handlers::mcp_tools::remove_task_mcp_tool,
            handlers::mcp_tools::update_mcp_tool,
            // ---------------- mcp servers (ctq-115, ADR-0008) ----------------
            handlers::mcp_servers::create_mcp_server,
            handlers::mcp_servers::delete_mcp_server,
            handlers::mcp_servers::get_mcp_server,
            handlers::mcp_servers::get_mcp_server_connection_hint,
            handlers::mcp_servers::get_mcp_server_status,
            handlers::mcp_servers::list_mcp_servers,
            handlers::mcp_servers::list_mcp_tools_by_server,
            handlers::mcp_servers::refresh_mcp_server,
            handlers::mcp_servers::update_mcp_server,
            // mcp server-as-unit attachments (Phase C)
            handlers::mcp_servers::list_role_mcp_servers,
            handlers::mcp_servers::set_role_mcp_servers,
            handlers::mcp_servers::list_board_mcp_servers,
            handlers::mcp_servers::set_board_mcp_servers,
            handlers::mcp_servers::list_task_mcp_servers,
            handlers::mcp_servers::set_task_mcp_servers,
            // ---------------- tags (E2.4 + ctq-108) ----------------
            handlers::tags::add_prompt_tag,
            handlers::tags::create_tag,
            handlers::tags::delete_tag,
            handlers::tags::get_tag,
            handlers::tags::list_prompt_tags_map,
            handlers::tags::list_tags,
            handlers::tags::remove_prompt_tag,
            handlers::tags::set_tag_prompts,
            handlers::tags::update_tag,
            // ---------------- agent reports (E2.4) ----------------
            handlers::reports::create_agent_report,
            handlers::reports::delete_agent_report,
            handlers::reports::get_agent_report,
            handlers::reports::list_agent_reports,
            handlers::reports::update_agent_report,
            // ---------------- attachments (E2.4 + E5 + ctq-110) ----------------
            handlers::attachments::create_attachment,
            handlers::attachments::delete_attachment,
            handlers::attachments::get_attachment,
            handlers::attachments::list_attachments,
            handlers::attachments::update_attachment,
            handlers::attachments::upload_attachment,
            handlers::attachments::upload_attachment_blob,
            // ---------------- prompt groups (E2.x) ----------------
            handlers::prompt_groups::add_prompt_group_member,
            handlers::prompt_groups::create_prompt_group,
            handlers::prompt_groups::delete_prompt_group,
            handlers::prompt_groups::get_prompt_group,
            handlers::prompt_groups::list_prompt_group_members,
            handlers::prompt_groups::list_prompt_groups,
            handlers::prompt_groups::remove_prompt_group_member,
            handlers::prompt_groups::set_prompt_group_members,
            handlers::prompt_groups::update_prompt_group,
            // prompt-group attachments (groups as live units)
            handlers::prompt_groups::list_role_prompt_groups,
            handlers::prompt_groups::set_role_prompt_groups,
            handlers::prompt_groups::list_board_prompt_groups,
            handlers::prompt_groups::set_board_prompt_groups,
            handlers::prompt_groups::list_task_prompt_groups,
            handlers::prompt_groups::set_task_prompt_groups,
            // ---------------- mcp tool groups ----------------
            handlers::mcp_tool_groups::list_mcp_tool_groups,
            handlers::mcp_tool_groups::get_mcp_tool_group,
            handlers::mcp_tool_groups::create_mcp_tool_group,
            handlers::mcp_tool_groups::update_mcp_tool_group,
            handlers::mcp_tool_groups::delete_mcp_tool_group,
            handlers::mcp_tool_groups::list_mcp_tool_group_members,
            handlers::mcp_tool_groups::add_mcp_tool_group_member,
            handlers::mcp_tool_groups::remove_mcp_tool_group_member,
            handlers::mcp_tool_groups::set_mcp_tool_group_members,
            handlers::mcp_tool_groups::list_role_mcp_tool_groups,
            handlers::mcp_tool_groups::set_role_mcp_tool_groups,
            handlers::mcp_tool_groups::list_board_mcp_tool_groups,
            handlers::mcp_tool_groups::set_board_mcp_tool_groups,
            handlers::mcp_tool_groups::list_task_mcp_tool_groups,
            handlers::mcp_tool_groups::set_task_mcp_tool_groups,
            // ---------------- settings ----------------
            handlers::settings::get_setting,
            handlers::settings::ping,
            handlers::settings::set_setting,
            // ---------------- search (E4.1 + ctq-84) ----------------
            handlers::search::search_tasks,
            handlers::search::search_agent_reports,
            handlers::search::search_all,
            handlers::search::search_tasks_by_cat_and_space,
            // ---------------- sidecar (ADR-0002 spike, ctq-56) ----------------
            handlers::sidecar::sidecar_status,
            handlers::sidecar::sidecar_ping,
            handlers::sidecar::sidecar_start,
            handlers::sidecar::sidecar_stop,
            handlers::sidecar::sidecar_restart,
            // ---------------- connected providers (round-21) ----------------
            handlers::clients::add_provider,
            handlers::clients::get_sync_status,
            handlers::clients::list_connected_providers,
            handlers::clients::list_supported_providers,
            handlers::clients::remove_provider,
        ])
        .build(tauri::generate_context!())
    {
        Ok(a) => a,
        Err(err) => {
            eprintln!("[catique-hub] tauri build failed: {err}");
            return;
        }
    };

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            // ADR-0002 spike: graceful sidecar shutdown on app exit.
            // Tauri's event callback is sync; we create a minimal one-shot
            // Tokio runtime to await the stop() future within 2 seconds.
            // If the sidecar doesn't exit cleanly, the OS will reclaim it
            // when the parent process terminates.
            let state = app_handle.state::<AppState>();
            let sidecar = state.sidecar.clone();
            if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                rt.block_on(async move {
                    if let Err(e) = sidecar.stop(Duration::from_secs(2)).await {
                        eprintln!("[catique-hub] sidecar stop on exit: {e}");
                    }
                });
            }
        }
    });
}

/// Resolve the sidecar directory at startup.
///
/// * **dev** (`debug_assertions`) — workspace-root-relative `sidecar/`.
/// * **prod** — the `sidecar/` staged under the bundle's resource dir by
///   the tauri.conf.json `resources` map (`"../sidecar": "sidecar"`).
///
/// The release branch probes the known per-platform bundle layouts and
/// returns the first candidate that actually contains `index.js`, so it
/// is robust to Tauri's `_up_` path rewriting and the macOS
/// `Contents/Resources` vs. Windows/Linux side-by-side layouts.
fn resolve_sidecar_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // src-tauri/ -> workspace root -> sidecar/
        return manifest
            .parent()
            .map_or_else(|| PathBuf::from("sidecar"), |root| root.join("sidecar"));
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Windows / Linux: resources sit next to the launcher.
            candidates.push(dir.join("sidecar"));
            candidates.push(dir.join("resources").join("sidecar"));
            // macOS: Contents/MacOS/<exe> -> Contents/Resources/sidecar.
            if let Some(contents) = dir.parent() {
                let res = contents.join("Resources");
                candidates.push(res.join("sidecar"));
                // Fallback for Tauri's `../` -> `_up_` rewriting.
                candidates.push(res.join("_up_").join("sidecar"));
            }
        }
    }
    candidates
        .into_iter()
        .find(|p| p.join("index.js").exists())
        .unwrap_or_else(|| PathBuf::from("sidecar"))
}

/// Resolve an absolute path to a Node runtime for the bundled sidecar.
///
/// GUI apps launched from Finder/Dock inherit a minimal `PATH`
/// (`/usr/bin:/bin:/usr/sbin:/sbin`) that omits Homebrew, nvm and Volta
/// install dirs, so a bare `Command::new("node")` fails with `ENOENT`
/// even when Node is installed. Probe the common locations and fall back
/// to `node` from `PATH` only as a last resort. An explicit
/// `CATIQUE_NODE_BIN` override always wins.
fn resolve_node_bin() -> String {
    const FIXED: &[&str] = &[
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];

    if let Ok(explicit) = std::env::var("CATIQUE_NODE_BIN") {
        if !explicit.trim().is_empty() {
            return explicit;
        }
    }

    for candidate in FIXED {
        if Path::new(candidate).exists() {
            return (*candidate).to_string();
        }
    }

    // nvm: ~/.nvm/versions/node/<version>/bin/node — pick the latest by
    // lexical version sort (good enough; nvm dirs are `vX.Y.Z`).
    if let Some(home) = std::env::var_os("HOME") {
        let nvm_root = PathBuf::from(home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                let node = latest.join("bin").join("node");
                if node.exists() {
                    return node.to_string_lossy().into_owned();
                }
            }
        }
    }

    "node".to_string()
}

/// Side-effect-bearing init: resolve path → open pool → run migrations.
/// Folded into a small helper so `run()` stays linear and testable
/// at the call-site level (via integration tests in E2.7).
fn init_state(sidecar_dir: PathBuf) -> Result<AppState, String> {
    // Settings → Data → Import stages a candidate DB and asks for a
    // restart. Apply the swap here, before the pool opens the live file.
    match catique_infrastructure::db::apply_pending_import() {
        Ok(true) => eprintln!("[catique-hub] applied staged database import"),
        Ok(false) => {}
        Err(e) => eprintln!("[catique-hub] pending import skipped: {e}"),
    }

    let path = db_path().map_err(|e| format!("resolve db path: {e}"))?;
    // Was there an existing DB before we opened (and thus possibly
    // created) the file? Drives the recovery-snapshot decision below.
    let db_existed = path.exists();
    let pool =
        open_pool(&path).map_err(|e| format!("open sqlite pool at {}: {e}", path.display()))?;

    // Recovery snapshot: capture the DB exactly as it is at launch,
    // *before* any pending migration this run applies, so a bad upgrade
    // (or a user mistake) can be rolled back via Settings → Data → Import.
    // First launch (no prior DB) has nothing worth snapshotting. The
    // whole step is best-effort and never blocks startup.
    if db_existed {
        match catique_infrastructure::db::backup::write_launch_backup(&pool) {
            Ok(p) => eprintln!("[catique-hub] recovery snapshot: {}", p.display()),
            Err(e) => eprintln!("[catique-hub] recovery snapshot skipped: {e}"),
        }
    }

    let mut conn = pool
        .get()
        .map_err(|e| format!("acquire migration connection: {e}"))?;
    let applied = run_pending(&mut conn).map_err(|e| format!("run migrations: {e}"))?;
    drop(conn);

    if !applied.is_empty() {
        let names: Vec<&str> = applied.iter().map(|m| m.name.as_str()).collect();
        eprintln!("[catique-hub] applied migrations: {names:?}");
    }

    // ADR-0006 (resolver-backfill): on first boot post-ctq-98, walk
    // every existing role/board/column/space attachment and materialise
    // origin-tagged rows in `task_prompts`. Idempotent + chunked — see
    // `resolver_backfill::run_if_pending` for the strategy. Failure
    // here is non-fatal: the resolver still works for any new
    // attachments going forward, and the next boot retries the walker.
    match catique_application::resolver_backfill::run_if_pending(&pool) {
        Ok(0) => {}
        Ok(n) => eprintln!("[catique-hub] resolver backfill materialised {n} rows"),
        Err(e) => eprintln!("[catique-hub] resolver backfill skipped: {e}"),
    }

    Ok(AppState::new(pool, sidecar_dir))
}
