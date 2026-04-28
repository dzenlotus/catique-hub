//! Tauri 2.x realtime event taxonomy + emit helper (Wave-E2.5).
//!
//! Per ADR-0001 (D-022) the realtime channel between Rust and the
//! webview is Tauri events. The frontend listens via
//! `import { listen } from '@tauri-apps/api/event'`; the Rust side
//! emits via `tauri::Emitter::emit` on the [`tauri::AppHandle`] held in
//! [`AppState::app_handle`].
//!
//! ## Why string constants, not an enum
//!
//! Tauri events are strings on the wire. Exposing an enum on the Rust
//! side and an enum-shaped union on the TS side adds two failure modes
//! (drift between the two, and conversion churn) for zero ergonomic
//! gain — both sides ultimately have to spell the names out. We
//! standardise on `pub const` strings and assert in tests that the
//! constants compile.
//!
//! ## Event-name format
//!
//! Tauri 2.x restricts event names to **alphanumeric, `-`, `/`, `:`,
//! `_`** — `.` is rejected at runtime by `AppHandle::emit`. We use
//! `<domain>:<verb>` (colon-namespaced) for every event constant. The
//! original convention (`<domain>.<verb>`) was retired after a runtime
//! crash in production startup; see git history for the migration.
//!
//! ## Why emit from handlers, not use cases
//!
//! Use cases live in `catique-application` and stay free of Tauri
//! deps — they're easy to test without spinning up an app. Handlers
//! are already the seam where we know the IPC succeeded; adding
//! `events::emit(...)` after the use-case call keeps each handler one
//! or two lines longer at most.
//!
//! ## Test-mode silence
//!
//! `AppState::app_handle` is a [`once_cell::sync::OnceCell`] — empty
//! in unit tests (no Tauri app to wire it). [`emit`] short-circuits on
//! that empty cell so handlers can run end-to-end against an in-memory
//! pool without ever needing a mock event bus.
//!
//! ## Multi-window outlook (E5+)
//!
//! `AppHandle::emit` already broadcasts to every webview attached to
//! the app. When E5 lands a second window (e.g. a focused-task popout)
//! the same emit calls reach both — no further plumbing required.

use serde::Serialize;
use tauri::Emitter;

use crate::state::AppState;

// -----------------------------------------------------------------
// Resource lifecycle event names. Format: `<entity>:<verb>`.
// -----------------------------------------------------------------

/// `board:created` — payload `{ id }`.
pub const BOARD_CREATED: &str = "board:created";
/// `board:updated` — payload `{ id }`.
pub const BOARD_UPDATED: &str = "board:updated";
/// `board:deleted` — payload `{ id }`.
pub const BOARD_DELETED: &str = "board:deleted";

/// `column:created` — payload `{ id, board_id }`.
pub const COLUMN_CREATED: &str = "column:created";
/// `column:updated` — payload `{ id, board_id }`.
pub const COLUMN_UPDATED: &str = "column:updated";
/// `column:deleted` — payload `{ id, board_id }`.
pub const COLUMN_DELETED: &str = "column:deleted";

/// `task:created` — payload `{ id, column_id, board_id }`.
pub const TASK_CREATED: &str = "task:created";
/// `task:updated` — payload `{ id, column_id, board_id }`.
pub const TASK_UPDATED: &str = "task:updated";
/// `task:moved` — payload `{ id, from_column_id, to_column_id, board_id }`.
///
/// Emitted in addition to `task:updated` whenever an `update_task`
/// call changes the `column_id`. The frontend uses it to refetch the
/// origin column's view when a task leaves it; pure positional moves
/// (column unchanged) only emit `task:updated`.
pub const TASK_MOVED: &str = "task:moved";
/// `task:deleted` — payload `{ id, column_id, board_id }`.
pub const TASK_DELETED: &str = "task:deleted";

/// `space:created` — payload `{ id }`.
pub const SPACE_CREATED: &str = "space:created";
/// `space:updated` — payload `{ id }`.
pub const SPACE_UPDATED: &str = "space:updated";
/// `space:deleted` — payload `{ id }`.
pub const SPACE_DELETED: &str = "space:deleted";

/// `prompt:created` — payload `{ id }`.
pub const PROMPT_CREATED: &str = "prompt:created";
/// `prompt:updated` — payload `{ id }`.
pub const PROMPT_UPDATED: &str = "prompt:updated";
/// `prompt:deleted` — payload `{ id }`.
pub const PROMPT_DELETED: &str = "prompt:deleted";

/// `role:created` — payload `{ id }`.
pub const ROLE_CREATED: &str = "role:created";
/// `role:updated` — payload `{ id }`.
pub const ROLE_UPDATED: &str = "role:updated";
/// `role:deleted` — payload `{ id }`.
pub const ROLE_DELETED: &str = "role:deleted";

/// `tag:created` — payload `{ id }`.
pub const TAG_CREATED: &str = "tag:created";
/// `tag:updated` — payload `{ id }`.
pub const TAG_UPDATED: &str = "tag:updated";
/// `tag:deleted` — payload `{ id }`.
pub const TAG_DELETED: &str = "tag:deleted";

/// `skill:created` — payload `{ id }`.
pub const SKILL_CREATED: &str = "skill:created";
/// `skill:updated` — payload `{ id }`.
pub const SKILL_UPDATED: &str = "skill:updated";
/// `skill:deleted` — payload `{ id }`.
pub const SKILL_DELETED: &str = "skill:deleted";

/// `mcp_tool:created` — payload `{ id }`.
pub const MCP_TOOL_CREATED: &str = "mcp_tool:created";
/// `mcp_tool:updated` — payload `{ id }`.
pub const MCP_TOOL_UPDATED: &str = "mcp_tool:updated";
/// `mcp_tool:deleted` — payload `{ id }`.
pub const MCP_TOOL_DELETED: &str = "mcp_tool:deleted";

/// `prompt_group:created` — payload `{ id }`.
pub const PROMPT_GROUP_CREATED: &str = "prompt_group:created";
/// `prompt_group:updated` — payload `{ id }`.
pub const PROMPT_GROUP_UPDATED: &str = "prompt_group:updated";
/// `prompt_group:deleted` — payload `{ id }`.
pub const PROMPT_GROUP_DELETED: &str = "prompt_group:deleted";
/// `prompt_group:members_changed` — payload `{ group_id }`.
///
/// Emitted after `add_member`, `remove_member`, and `set_members` so
/// the frontend can invalidate the members query without refetching the
/// group entity itself.
pub const PROMPT_GROUP_MEMBERS_CHANGED: &str = "prompt_group:members_changed";

/// `agent_report:created` — payload `{ id, task_id }`.
pub const AGENT_REPORT_CREATED: &str = "agent_report:created";
/// `agent_report:updated` — payload `{ id, task_id }`.
pub const AGENT_REPORT_UPDATED: &str = "agent_report:updated";
/// `agent_report:deleted` — payload `{ id, task_id }`.
pub const AGENT_REPORT_DELETED: &str = "agent_report:deleted";

/// `attachment:created` — payload `{ id, task_id }`.
pub const ATTACHMENT_CREATED: &str = "attachment:created";
/// `attachment:updated` — payload `{ id, task_id }`.
pub const ATTACHMENT_UPDATED: &str = "attachment:updated";
/// `attachment:deleted` — payload `{ id, task_id }`.
pub const ATTACHMENT_DELETED: &str = "attachment:deleted";

// -----------------------------------------------------------------
// Import lifecycle events.
// -----------------------------------------------------------------

/// `import:started` — payload `{ source_path }`.
pub const IMPORT_STARTED: &str = "import:started";
/// `import:progress` — payload `{ phase, percent }`. Reserved; not
/// emitted in E2.5 (no callback hook in the use case yet).
pub const IMPORT_PROGRESS: &str = "import:progress";
/// `import:completed` — payload `{ duration_ms, rows_imported, commit_path }`.
pub const IMPORT_COMPLETED: &str = "import:completed";
/// `import:failed` — payload `{ error_kind, message }`.
pub const IMPORT_FAILED: &str = "import:failed";

// -----------------------------------------------------------------
// Generic / future
// -----------------------------------------------------------------

/// `app:refresh-required` — whole-cache invalidation hint. Reserved;
/// not currently emitted but listed so the frontend keeps the listener
/// path warm against the day a Wave-A migration / DB swap fires it.
pub const APP_REFRESH_REQUIRED: &str = "app:refresh-required";

/// Emit a typed Tauri event to every webview attached to the app.
///
/// Behaviour:
///
/// * If [`AppState::app_handle`] is unset (test mode) → silent no-op.
/// * On `AppHandle::emit` failure → log via `eprintln!` and swallow.
///   We *never* propagate emit failures up to the handler return
///   value — they're best-effort UI sync; the IPC mutation itself has
///   already committed by this point and surfacing an error here would
///   make the user think the write failed.
pub fn emit<S>(state: &AppState, name: &str, payload: S)
where
    S: Serialize + Clone,
{
    let Some(app) = state.app_handle.get() else {
        // Test mode (no Tauri app installed). Silent skip is part of
        // the contract documented at the top of this module.
        return;
    };
    if let Err(e) = app.emit(name, payload) {
        eprintln!("[catique-hub] tauri emit({name}) failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    //! Test-mode contract. We can't exercise a real `AppHandle::emit`
    //! without spinning up a Tauri app, so the focus is the silent
    //! no-op when the cell is empty.

    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use serde_json::json;

    #[test]
    fn emit_without_app_handle_is_silent_noop() {
        let state = AppState::new(memory_pool_for_tests(), std::path::PathBuf::new());
        emit(&state, BOARD_CREATED, json!({ "id": "b1" }));
        emit(
            &state,
            TASK_MOVED,
            json!({
                "id": "t1",
                "from_column_id": "c1",
                "to_column_id": "c2",
                "board_id": "bd1",
            }),
        );
        assert!(state.app_handle.get().is_none());
    }

    #[test]
    fn event_name_constants_are_colon_namespaced() {
        // Tauri 2.x permits only alphanumeric + `-/:_` in event names.
        // Compile-check that every constant follows `<domain>:<verb>`
        // and uses no forbidden characters (notably `.`).
        const FORBIDDEN: &[char] = &['.', ' ', '\t', '\n'];
        for name in [
            BOARD_CREATED,
            BOARD_UPDATED,
            BOARD_DELETED,
            COLUMN_CREATED,
            COLUMN_UPDATED,
            COLUMN_DELETED,
            TASK_CREATED,
            TASK_UPDATED,
            TASK_MOVED,
            TASK_DELETED,
            SPACE_CREATED,
            SPACE_UPDATED,
            SPACE_DELETED,
            PROMPT_CREATED,
            PROMPT_UPDATED,
            PROMPT_DELETED,
            ROLE_CREATED,
            ROLE_UPDATED,
            ROLE_DELETED,
            TAG_CREATED,
            TAG_UPDATED,
            TAG_DELETED,
            AGENT_REPORT_CREATED,
            AGENT_REPORT_UPDATED,
            AGENT_REPORT_DELETED,
            ATTACHMENT_CREATED,
            ATTACHMENT_UPDATED,
            ATTACHMENT_DELETED,
            SKILL_CREATED,
            SKILL_UPDATED,
            SKILL_DELETED,
            MCP_TOOL_CREATED,
            MCP_TOOL_UPDATED,
            MCP_TOOL_DELETED,
            IMPORT_STARTED,
            IMPORT_PROGRESS,
            IMPORT_COMPLETED,
            IMPORT_FAILED,
            APP_REFRESH_REQUIRED,
            PROMPT_GROUP_CREATED,
            PROMPT_GROUP_UPDATED,
            PROMPT_GROUP_DELETED,
            PROMPT_GROUP_MEMBERS_CHANGED,
        ] {
            assert!(
                name.contains(':') || name.contains('-'),
                "event name `{name}` must be colon-namespaced (`<domain>:<verb>`) or dash-form",
            );
            assert!(name.is_ascii(), "event name `{name}` is not ascii");
            for ch in FORBIDDEN {
                assert!(
                    !name.contains(*ch),
                    "event name `{name}` contains forbidden char `{ch}` — Tauri 2.x rejects it"
                );
            }
            assert!(!name.is_empty());
        }
    }
}
