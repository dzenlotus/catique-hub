# MCP Contract and Task Depth Audit

**Date:** 2026-05-05
**Auditor:** Catique HUB tech analyst
**Scope:** MCP server contract gaps, task surface depth, attachment and agent-report completeness, entity coverage for autonomous agent work.
**Status of MCP bridge:** The real MCP bridge (E5) has not been written. The `crates/sidecar` crate is a lifecycle-manager spike only (`sidecar/index.js` handles `ping` and `shutdown` exclusively — `sidecar/index.js:48,53`). The actual agent-facing tool surface is the **Tauri IPC layer** registered in `src-tauri/src/lib.rs:71-186`. An MCP-aware agent calling `mcp__catique__*` tools does not yet exist; all tool references in this audit describe IPC commands that an MCP bridge would need to proxy.

---

## Executive Summary

Total findings: **2 P0 / 4 P1 / 5 P2 / 3 P3**

**Top-3 highest-impact actions:**

1. **Wire `log_step` and `rate_task` as Tauri IPC commands** (P0). Both use-case methods exist in `crates/application/src/tasks.rs:211,249` and are fully implemented with validation. No `#[tauri::command]` handler exists; neither appears in the `generate_handler!` list (`src-tauri/src/lib.rs:91-101`). An agent literally cannot log its progress or signal task quality today.

2. **Expose `get_task_rating` as a Tauri IPC command** (P0). Same gap: the use-case method exists at `crates/application/src/tasks.rs:278` but there is no handler and no registration. `bindings/TaskRating.ts` exists, proving the domain type is serialisable, but the command that returns it is absent.

3. **Build a real MCP bridge (E5)** (P0). `sidecar/index.js` is a PoC with only `ping` and `shutdown` — `sidecar/index.js:48,53`. No MCP tool is defined. ADR-0002 explicitly labels the sidecar "NOT the real MCP server" (`sidecar/index.js:8`). Until E5 ships, every Tauri IPC command in this audit is invisible to an external agent.

**Is the MCP contract good enough for an agent to do real work today?**

No. There are two compounding blockers. First, the MCP bridge (E5) has not been written, so no external agent can call any tool via the MCP protocol — the sidecar only handles `ping` and `shutdown`. Second, even if the MCP bridge were wired today to proxy all registered Tauri IPC commands, the agent still could not log its own progress (`log_step` is unregistered) or signal task quality (`rate_task`, `get_task_rating` are unregistered) — the two Cat-as-Agent Phase 1 features that are load-bearing for autonomous operation. The Tauri IPC surface is otherwise well-structured and broad enough to support agent operation once E5 and the three missing commands land.

---

## Section 1 — MCP Tool Inventory

No `mcp__catique__*` tools exist at the protocol level. The table below enumerates the **Tauri IPC commands** registered in `src-tauri/src/lib.rs:71-186` — these are the commands an MCP bridge (E5) must proxy. A star (★) marks commands whose underlying domain has changed since the command was last touched (schema additions not yet reflected in the handler signature or output shape).

### Spaces (5 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_space` | `handlers/spaces.rs` | ★ `color`, `icon` columns added in 008 — handler accepts and returns them (`handlers/spaces.rs:58-67`) |
| `get_space` | `handlers/spaces.rs` | |
| `list_spaces` | `handlers/spaces.rs` | |
| `update_space` | `handlers/spaces.rs` | ★ `color`, `icon` patchable |
| `delete_space` | `handlers/spaces.rs` | |

### Boards (5 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_board` | `handlers/boards.rs` | ★ `color`, `icon`, `is_default` added (008/009); `owner_role_id` added (004) |
| `get_board` | `handlers/boards.rs` | |
| `list_boards` | `handlers/boards.rs` | |
| `update_board` | `handlers/boards.rs` | ★ `color`, `icon` patchable; `is_default` exposed |
| `delete_board` | `handlers/boards.rs` | |

### Columns (5 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_column` | `handlers/columns.rs` | |
| `get_column` | `handlers/columns.rs` | |
| `list_columns` | `handlers/columns.rs` | |
| `update_column` | `handlers/columns.rs` | |
| `delete_column` | `handlers/columns.rs` | |

### Tasks (10 commands — MISSING 3)

| Command | Handler file | Notes |
|---|---|---|
| `create_task` | `handlers/tasks.rs` | |
| `get_task` | `handlers/tasks.rs` | ★ `step_log` field added (004) — present in `Task` domain type and `bindings/Task.ts` |
| `list_tasks` | `handlers/tasks.rs` | ★ `step_log` field present |
| `update_task` | `handlers/tasks.rs` | |
| `delete_task` | `handlers/tasks.rs` | |
| `add_task_prompt` | `handlers/tasks.rs` | |
| `remove_task_prompt` | `handlers/tasks.rs` | |
| `list_task_prompts` | `handlers/tasks.rs` | |
| `set_task_prompt_override` | `handlers/tasks.rs` | |
| `clear_task_prompt_override` | `handlers/tasks.rs` | |
| ~~`log_step`~~ | **MISSING** | Use case: `tasks.rs:211`. No handler, not registered. |
| ~~`rate_task`~~ | **MISSING** | Use case: `tasks.rs:249`. No handler, not registered. |
| ~~`get_task_rating`~~ | **MISSING** | Use case: `tasks.rs:278`. No handler, not registered. |

### Prompts (10 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_prompt` | `handlers/prompts.rs` | ★ `icon` (005), `examples_json` (006) added |
| `get_prompt` | `handlers/prompts.rs` | ★ `icon`, `examples` in output |
| `list_prompts` | `handlers/prompts.rs` | ★ |
| `update_prompt` | `handlers/prompts.rs` | ★ `icon`, `examples` patchable |
| `delete_prompt` | `handlers/prompts.rs` | |
| `add_board_prompt` | `handlers/prompts.rs` | |
| `remove_board_prompt` | `handlers/prompts.rs` | |
| `add_column_prompt` | `handlers/prompts.rs` | |
| `remove_column_prompt` | `handlers/prompts.rs` | |
| `recompute_prompt_token_count` | `handlers/prompts.rs` | |

### Roles / Cats (11 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_role` | `handlers/roles.rs` | ★ `is_system` added (004) — system cats non-editable |
| `get_role` | `handlers/roles.rs` | ★ `is_system` in output |
| `list_roles` | `handlers/roles.rs` | ★ |
| `update_role` | `handlers/roles.rs` | |
| `delete_role` | `handlers/roles.rs` | |
| `add_role_prompt` | `handlers/roles.rs` | |
| `remove_role_prompt` | `handlers/roles.rs` | |
| `add_role_skill` | `handlers/roles.rs` | |
| `remove_role_skill` | `handlers/roles.rs` | |
| `add_role_mcp_tool` | `handlers/roles.rs` | |
| `remove_role_mcp_tool` | `handlers/roles.rs` | |

### Skills (5 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_skill` | `handlers/skills.rs` | |
| `get_skill` | `handlers/skills.rs` | |
| `list_skills` | `handlers/skills.rs` | |
| `update_skill` | `handlers/skills.rs` | |
| `delete_skill` | `handlers/skills.rs` | |

### MCP Tools (5 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_mcp_tool` | `handlers/mcp_tools.rs` | |
| `get_mcp_tool` | `handlers/mcp_tools.rs` | |
| `list_mcp_tools` | `handlers/mcp_tools.rs` | |
| `update_mcp_tool` | `handlers/mcp_tools.rs` | |
| `delete_mcp_tool` | `handlers/mcp_tools.rs` | |

### Tags (8 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_tag` | `handlers/tags.rs` | |
| `get_tag` | `handlers/tags.rs` | |
| `list_tags` | `handlers/tags.rs` | |
| `update_tag` | `handlers/tags.rs` | |
| `delete_tag` | `handlers/tags.rs` | |
| `add_prompt_tag` | `handlers/tags.rs` | |
| `remove_prompt_tag` | `handlers/tags.rs` | |
| `list_prompt_tags_map` | `handlers/tags.rs` | |

### Agent Reports (5 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_agent_report` | `handlers/reports.rs` | Full CRUD present |
| `get_agent_report` | `handlers/reports.rs` | |
| `list_agent_reports` | `handlers/reports.rs` | |
| `update_agent_report` | `handlers/reports.rs` | |
| `delete_agent_report` | `handlers/reports.rs` | |

### Attachments (6 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_attachment` | `handlers/attachments.rs` | Metadata-only; no blob copy |
| `get_attachment` | `handlers/attachments.rs` | |
| `list_attachments` | `handlers/attachments.rs` | Returns ALL attachments — no task filter param |
| `update_attachment` | `handlers/attachments.rs` | filename + uploaded_by only |
| `delete_attachment` | `handlers/attachments.rs` | Metadata row only; blob not removed |
| `upload_attachment` | `handlers/attachments.rs` | Copies blob from `source_path` on local FS; MCP-hostile |

### Prompt Groups (9 commands)

| Command | Handler file | Notes |
|---|---|---|
| `create_prompt_group` | `handlers/prompt_groups.rs` | ★ `icon` added (007) |
| `get_prompt_group` | `handlers/prompt_groups.rs` | ★ |
| `list_prompt_groups` | `handlers/prompt_groups.rs` | ★ |
| `update_prompt_group` | `handlers/prompt_groups.rs` | ★ |
| `delete_prompt_group` | `handlers/prompt_groups.rs` | |
| `add_prompt_group_member` | `handlers/prompt_groups.rs` | |
| `remove_prompt_group_member` | `handlers/prompt_groups.rs` | |
| `list_prompt_group_members` | `handlers/prompt_groups.rs` | |
| `set_prompt_group_members` | `handlers/prompt_groups.rs` | |

### Search (3 commands)

| Command | Handler file | Notes |
|---|---|---|
| `search_tasks` | `handlers/search.rs` | FTS5 |
| `search_agent_reports` | `handlers/search.rs` | FTS5 |
| `search_all` | `handlers/search.rs` | |

### Connected Clients / Sidecar (10 commands)

| Command | Handler file | Notes |
|---|---|---|
| `discover_clients` | `handlers/clients.rs` | |
| `list_connected_clients` | `handlers/clients.rs` | |
| `set_client_enabled` | `handlers/clients.rs` | |
| `read_client_instructions` | `handlers/clients.rs` | |
| `write_client_instructions` | `handlers/clients.rs` | |
| `list_synced_client_roles` | `handlers/clients.rs` | |
| `sync_roles_to_client` | `handlers/clients.rs` | |
| `sidecar_status` | `handlers/sidecar.rs` | |
| `sidecar_ping` | `handlers/sidecar.rs` | |
| `sidecar_restart` | `handlers/sidecar.rs` | |

### Settings (1 command)

| Command | Handler file | Notes |
|---|---|---|
| `ping` | `handlers/settings.rs` | Health-check stub |

**Total registered IPC commands: 93**
**Commands with no MCP-bridge proxy yet: all 93** (E5 not yet written)
**Commands missing handler entirely: 3** (`log_step`, `rate_task`, `get_task_rating`)

---

## Section 2 — Findings

### F-01 — `log_step` has no Tauri command handler (P0)

- **File:line:** `src-tauri/src/lib.rs:91-101` (gap), `crates/application/src/tasks.rs:211` (use case)
- **Current state:** `TasksUseCase::log_step` is fully implemented with length validation (≤ 50 000 chars) and `NotFound` pre-check. No `#[tauri::command]` function exists in `crates/api/src/handlers/tasks.rs`. The command is absent from `generate_handler!`.
- **Gap:** An agent cannot append step-log lines to a task. The Cat-as-Agent Phase 1 chain-of-thought buffer is write-locked from all callers except internal Rust code that is never invoked.
- **Fix size:** S — add a 10-line handler function to `handlers/tasks.rs`, add one line to `generate_handler!`, regenerate bindings.
- **Task title:** `[P0] Wire log_step Tauri command — agent step log is unwritable`

### F-02 — `rate_task` and `get_task_rating` have no Tauri command handlers (P0)

- **File:line:** `src-tauri/src/lib.rs:91-101` (gap), `crates/application/src/tasks.rs:249,278` (use cases), `bindings/TaskRating.ts:1` (type exists)
- **Current state:** Both use-case methods fully implemented. `TaskRating` domain type and TS binding exist. Zero handler code in `handlers/tasks.rs`.
- **Gap:** An agent cannot record task quality signal or read back any rating. The Phase 1 three-state quality system (rated / explicit-neutral / unrated) is entirely inaccessible via IPC.
- **Fix size:** S — two handler functions (~15 lines each), two `generate_handler!` entries.
- **Task title:** `[P0] Wire rate_task + get_task_rating Tauri commands`

### F-03 — No MCP protocol bridge (E5 not started) (P0)

- **File:line:** `sidecar/index.js:8` ("NOT the real MCP server"), `ADR-0002:169-172` ("Real MCP protocol implementation ... deferred to E5")
- **Current state:** `sidecar/index.js` answers only `ping` and `shutdown`. No `@modelcontextprotocol/sdk` integration exists. The MCP server from Promptery is not yet ported or wrapped.
- **Gap:** External agents (Claude Code, Claude Desktop, etc.) cannot invoke any Catique HUB functionality via the MCP protocol. All 93 IPC commands are invisible at the MCP layer.
- **Fix size:** L — E5 work: hub-bridge mode design (ADR-0002 OQ-1), SDK integration, tool manifest, stdin/stdout framing per MCP spec, auth (ADR-0002 OQ-2).
- **Task title:** `[P0] E5 — implement real MCP bridge with tool surface`

### F-04 — `upload_attachment` requires local filesystem path — MCP-hostile (P1)

- **File:line:** `crates/api/src/handlers/attachments.rs:187-274` (`upload_attachment` handler)
- **Current state:** `upload_attachment` takes a `source_path: String` — an absolute path on the local filesystem of the Tauri host. It copies the blob to `$APPLOCALDATA/catique/attachments/<task_id>/` and inserts the metadata row.
- **Gap:** An MCP agent running remotely (or even a local agent without direct FS access) cannot call this command because it cannot produce a valid local `source_path`. The `create_attachment` metadata-only command exists but requires the blob to already be on disk at the right path — equally inaccessible.
- **Fix size:** M — design a base64 or streaming upload variant that accepts blob content over IPC rather than a path reference.
- **Task title:** `[P1] Add blob-content upload_attachment variant for MCP agents`

### F-05 — `list_attachments` has no `task_id` filter (P1)

- **File:line:** `crates/api/src/handlers/attachments.rs:34` (`list_attachments`)
- **Current state:** `list_attachments` returns every attachment across all tasks. No `task_id` parameter.
- **Gap:** An agent working on task `X` must download the entire attachment table and filter client-side. In a project with thousands of tasks this is wasteful. The schema index `idx_task_attachments_task` (`001_initial.sql:301`) exists precisely for this query pattern.
- **Fix size:** S — add optional `task_id` param to handler and use case, add `WHERE task_id = ?` branch.
- **Task title:** `[P1] Add task_id filter to list_attachments`

### F-06 — `get_task_bundle` equivalent is missing (P1)

- **File:line:** `crates/api/src/handlers/tasks.rs:24-265` (task commands)
- **Current state:** Getting a full task context requires at minimum: `get_task` + `list_task_prompts` + `list_attachments` (filtered) + `list_agent_reports` (filtered by task_id — also missing a filter) + `get_task_rating`. That is 4-5 round trips, with two of them currently broken (rating) or unfiltered (attachments, reports).
- **Gap:** Promptery had `get_task_bundle` that returned description, role chain, prompt union with origins, and attachments in one call. Catique HUB has no equivalent. Each round trip through the sidecar adds ~2-20 ms of IPC overhead; 5 sequential calls = ~10-100 ms before any agent reasoning begins.
- **Fix size:** M — new use-case method `get_task_bundle` joining tasks + prompts + attachments + reports + rating in one DB transaction; new handler; new command.
- **Task title:** `[P1] Add get_task_bundle command for single-call context fetch`

### F-07 — `list_agent_reports` has no `task_id` filter (P2)

- **File:line:** `crates/api/src/handlers/reports.rs:25` (`list_agent_reports`)
- **Current state:** Returns all reports globally, newest-first. No `task_id` parameter. The schema index `idx_agent_reports_task` (`001_initial.sql:382`) exists for per-task queries.
- **Gap:** Agent cannot efficiently retrieve only its own prior reports for a given task — it must scan and filter the global list.
- **Fix size:** S — add optional `task_id` param, `WHERE task_id = ?` branch.
- **Task title:** `[P2] Add task_id filter to list_agent_reports`

### F-08 — `task_skills` and `task_mcp_tools` join tables have no IPC surface (P2)

- **File:line:** `001_initial.sql:186-199` (tables), `crates/infrastructure/src/db/repositories/tasks.rs` (no `list_task_skills` function)
- **Current state:** `task_skills` and `task_mcp_tools` tables exist in the schema with `origin` columns (same pattern as `task_prompts`). There are no repository functions, use-case methods, or handlers to list, add, or remove these associations for a task. `role_skills` and `role_mcp_tools` have join-table helpers on the roles side.
- **Gap:** An agent cannot discover which skills or MCP tools are assigned to its current task via the inherited-role chain. The `origin` column pattern implies these were planned as part of the same inheritance resolver — but the resolver (E3) has not run yet.
- **Fix size:** M — repository functions + use-case methods + handlers mirroring `list_task_prompts` / `add_task_prompt` / `remove_task_prompt`.
- **Task title:** `[P2] Expose task_skills and task_mcp_tools via IPC`

### F-09 — `step_log` is read-only via `get_task` — no dedicated getter (P2)

- **File:line:** `crates/api/src/handlers/tasks.rs:35` (`get_task` returns full `Task` including `step_log`)
- **Current state:** `step_log` is embedded in the `Task` struct returned by `get_task`. Reading it requires fetching the entire task row including all other fields.
- **Gap:** For a long-running task with a multi-KB step log, every progress check fetches and deserialises the full task. A dedicated `get_step_log(task_id)` would be cheaper and makes the agent's intent explicit. `repositories::tasks::get_step_log` already exists at `tasks.rs:329`.
- **Fix size:** S — thin handler + use-case wrapper around existing `get_step_log` repo function.
- **Task title:** `[P2] Add get_step_log dedicated IPC command`

### F-10 — `delete_attachment` does not remove the blob from disk (P2)

- **File:line:** `crates/api/src/handlers/attachments.rs:113-123` (`delete_attachment`)
- **Current state:** `delete_attachment` removes only the metadata row from `task_attachments`. The physical file at `$APPLOCALDATA/catique/attachments/<task_id>/<id>_<name>` is left on disk (orphaned).
- **Gap:** Repeated agent attachment operations will accumulate orphaned blobs. `upload_attachment` performs the inverse (removes blob on insert failure — `attachments.rs:261`) so the symmetry is already understood; deletion just has not been extended to the blob side.
- **Fix size:** S — read `storage_path` before delete, attempt `fs::remove_file` after metadata delete, log but do not error on FS failure.
- **Task title:** `[P2] delete_attachment should also remove blob from disk`

### F-11 — `workflow_graph` has no IPC or schema surface (P3)

- **File:line:** ADR-0002 references "Phase 5" work; no migration or handler exists.
- **Current state:** No `workflow_graph` table, no handler, no domain type. Phase 5 is not yet started.
- **Gap:** An agent cannot query or contribute to a workflow graph. This is a known future gap, not a regression.
- **Fix size:** L — new schema, domain type, use case, handlers (Phase 5 scope).
- **Task title:** `[P3] Phase 5 scaffold — workflow_graph schema + placeholder IPC`

### F-12 — `settings` has only a `ping` command; `cat_migration_reviewed` unreadable via IPC (P3)

- **File:line:** `src-tauri/src/lib.rs:169` (`handlers::settings::ping`), `004_cat_as_agent_phase1.sql:140-142` (key seeded)
- **Current state:** The only settings IPC command is `ping`. `cat_migration_reviewed` is seeded in the DB but cannot be read or written by an agent via IPC. A human user dismisses the modal in the UI, which writes the key directly; no Tauri command exists for this key or the settings KV table in general.
- **Gap:** An agent cannot inspect or update settings state without a dedicated `get_setting` / `set_setting` command.
- **Fix size:** S — generic `get_setting(key)` / `set_setting(key, value)` commands; guard `cat_migration_reviewed` as UI-only if desired.
- **Task title:** `[P3] Add get_setting / set_setting IPC commands`

### F-13 — No `author` ownership guard on `update_agent_report` / `delete_agent_report` (P3)

- **File:line:** `crates/api/src/handlers/reports.rs:70-106` (`update_agent_report`, `delete_agent_report`)
- **Current state:** `update_agent_report` and `delete_agent_report` accept any `id` with no check against the `author` field. Any agent (or the UI) can mutate any other agent's report.
- **Gap:** For the "agent creates report, amends on next iteration" loop, the loop itself is supported (`update_agent_report` exists — see Section 5). The gap is that no authorship guard prevents a different agent from overwriting a peer's report. In a single-agent setup this is harmless; in multi-cat Phase 2 it becomes a correctness risk.
- **Fix size:** S — add optional `expected_author` param; return `Forbidden` if mismatch.
- **Task title:** `[P3] Add optional author guard to update/delete_agent_report`

---

## Section 3 — Task-Depth Comparison

`get_task` returns a `Task` struct. The table below maps every DB column and related field to what `get_task` returns, and what a `get_task_bundle` would need to add.

| DB source | Column / field | In `get_task` response | Notes |
|---|---|---|---|
| `tasks` | `id` | Yes | |
| `tasks` | `board_id` | Yes | |
| `tasks` | `column_id` | Yes | |
| `tasks` | `slug` | Yes | |
| `tasks` | `title` | Yes | |
| `tasks` | `description` | Yes | |
| `tasks` | `position` | Yes | |
| `tasks` | `role_id` | Yes | |
| `tasks` | `created_at` | Yes | |
| `tasks` | `updated_at` | Yes | |
| `tasks` | `step_log` | Yes — full buffer | Phase 1 addition (004) |
| `task_ratings` | `rating` | **No** | `get_task_rating` has no handler (F-02) |
| `task_ratings` | `rated_at` | **No** | Same gap |
| `task_prompts` | prompt list with origins | **Separate call** (`list_task_prompts`) | Returns prompts; `origin` column not surfaced — only `direct` prompts returned, inherited prompts require E3 resolver |
| `task_prompt_overrides` | override list | **No** | No `list_task_prompt_overrides` command exists |
| `task_skills` | skills with origins | **No** | No handler (F-08) |
| `task_mcp_tools` | tools with origins | **No** | No handler (F-08) |
| `task_attachments` | attachment list | **Separate call** (`list_attachments`) | No `task_id` filter (F-05); all attachments returned |
| `agent_reports` | reports list | **Separate call** (`list_agent_reports`) | No `task_id` filter (F-07) |
| `boards` | board name / space | **No** | Agent must call `get_board` separately |
| `columns` | column name | **No** | Agent must call `get_column` separately |
| `roles` | role content / prompts | **No** | Agent must call `get_role` + join tables |

**Summary:** A fully-informed agent requires a minimum of 5 IPC calls to assemble the equivalent of Promptery's `get_task_bundle`. Two of those calls are broken (rating) or return over-broad data (attachments, reports). The `origin` field on `task_prompts` is never surfaced to callers — the prompt inheritance chain (board → column → role → direct) is invisible.

---

## Section 4 — Attachment Surface Gap

### Current state

The attachment surface has 6 IPC commands (`src-tauri/src/lib.rs:151-157`):

- `create_attachment` — metadata-only insert; requires `storage_path` the caller has already placed on disk.
- `get_attachment` — single row by id.
- `list_attachments` — all rows, no filter.
- `update_attachment` — `filename` and `uploaded_by` only; no blob mutation.
- `delete_attachment` — metadata row only; leaves blob on disk (F-10).
- `upload_attachment` — copies blob from a **local filesystem path** (`crates/api/src/handlers/attachments.rs:187`). The storage path resolver is `catique_infrastructure::paths::app_data_dir()` joined with `attachments/<task_id>/` (`attachments.rs:215-219`).

### Gap for MCP agents

`upload_attachment` takes `source_path: String` — an absolute path on the machine running the Tauri app. An MCP agent (Claude Code, etc.) running in a separate process or on a different host cannot construct a valid `source_path` pointing into the Tauri host's filesystem. The only workaround is for the agent to write a file to the local disk first — which is not always possible or desirable.

### Tools needed

1. `upload_attachment_bytes(task_id, filename, mime_type, content_base64)` — accepts blob as base64 string, writes it to the same `$APPLOCALDATA/catique/attachments/<task_id>/` layout. IPC payload for a 1 MB file = ~1.33 MB base64; acceptable for agent use cases (screenshots, small diffs).
2. Fix `list_attachments` to accept optional `task_id` (F-05).
3. Fix `delete_attachment` to remove blob on disk (F-10).

The path resolver at `catique_infrastructure::paths::app_data_dir()` is already used by `upload_attachment` (`attachments.rs:215`); the new command would call the same function.

---

## Section 5 — Agent Reports Surface Gap

### What exists

Five IPC commands are registered (`src-tauri/src/lib.rs:145-150`):

| Command | Covers |
|---|---|
| `create_agent_report(task_id, kind, title, content, author)` | Create |
| `get_agent_report(id)` | Read one |
| `list_agent_reports()` | Read all (no filter) |
| `update_agent_report(id, kind?, title?, content?, author?)` | Partial update |
| `delete_agent_report(id)` | Delete |

The `AgentReportPatch` in the repository (`agent_reports.rs:55-61`) includes `kind`, `title`, `content`, and `author` — all patchable. FTS5 sync is handled by DB triggers (`001_initial.sql:392-408`).

### What is present for the "create → amend on next iteration" loop

The loop **is supported at the data layer**: an agent can `create_agent_report` on first run with `author = "my-cat-id"`, then on the next iteration call `update_agent_report` with the same `id` to patch `content` or `title`. The repository COALESCE logic at `agent_reports.rs:141-161` correctly handles partial updates. `updated_at` is bumped on every PATCH.

### What is missing

1. **`list_agent_reports` has no `task_id` filter** (F-07). An agent must scan all reports to find its own. Fix: add optional `task_id` to handler.
2. **No `search_agent_reports_by_task` shortcut.** `search_agent_reports` (FTS5) searches globally with no `task_id` scope. For an agent checking "did I write a plan for this task before?" the combination of `task_id` filter + FTS is the ideal query.
3. **No authorship guard on mutate** (F-13). Any caller can update or delete any report. This is safe in Phase 1 (single active agent) but becomes a correctness risk in multi-cat Phase 2.
4. **No pagination on `list_agent_reports`.** As the project accumulates reports the global scan will grow. FTS5 search (`search_agent_reports`) is the intended mitigation, but it requires knowing keywords to search for.

### Mutation guards needed

For the self-amendment loop to be safe in Phase 2:

```
update_agent_report(id, ..., expected_author?: string)
// Returns 403 Forbidden if report.author != expected_author
```

This is an additive change: callers that omit `expected_author` get current unrestricted behaviour; callers that supply it get ownership enforcement.

---

## Section 6 — What Works Well

1. **Full CRUD for all eight core entities** (spaces, boards, columns, tasks, prompts, roles, tags, agent reports) — 93 IPC commands registered and tested. The per-entity pattern is consistent and well-documented.

2. **Agent reports are complete** — `create`, `get`, `list`, `update`, `delete` all exist. The FTS5 trigger chain (`001_initial.sql:392-408`) keeps search in sync without any application-layer overhead. `update_agent_report` + `delete_agent_report` — which the audit brief suggested might be missing — are both present and fully implemented (`handlers/reports.rs:70-106`). The "create → amend" loop works today for a single-agent setup.

3. **Skills and MCP tools have full CRUD** — five commands each (`handlers/skills.rs`, `handlers/mcp_tools.rs`), registered in `src-tauri/src/lib.rs:124-135`. Role-level join tables (`role_skills`, `role_mcp_tools`) also have add/remove helpers on the roles side.

4. **`upload_attachment` is properly implemented** — blob copy with collision-safe naming, MIME inference, atomic cleanup on failure (`attachments.rs:187-274`). The path resolver (`catique_infrastructure::paths::app_data_dir`) is abstracted correctly for future platform porting.

5. **FTS5 search across tasks and reports** — `search_tasks`, `search_agent_reports`, `search_all` with configurable limits and Unicode tokenisation (`handlers/search.rs`). The triggers keep indexes in sync.

6. **Phase 1 schema is solid** — `step_log`, `task_ratings`, `is_system` roles, `owner_role_id` on boards, `cat_migration_reviewed` setting are all correctly migrated (004). The domain types and TS bindings are generated and up-to-date for every schema addition through migration 010.

7. **Connected client / role-sync surface is rich** — `discover_clients`, `list_connected_clients`, `set_client_enabled`, `read_client_instructions`, `write_client_instructions`, `list_synced_client_roles`, `sync_roles_to_client` — seven commands covering the full client-management lifecycle (`handlers/clients.rs`).

8. **Sidecar lifecycle is robust** — restart policy (≤ 3 / 60 s), 10 s heartbeat supervisor, graceful shutdown with 2 s timeout + SIGKILL fallback (`crates/sidecar/src/lib.rs`). The ADR is detailed and unambiguous about the E5 migration path.

---

## Section 7 — Recommended Next Tasks

Ordered by ROI (impact ÷ effort). Each task ≤ 80 chars.

| # | Size | Title |
|---|---|---|
| 1 | S | `[P0] Wire log_step Tauri command — agent step log is unwritable` |
| 2 | S | `[P0] Wire rate_task + get_task_rating Tauri commands` |
| 3 | S | `[P1] Add task_id filter to list_attachments` |
| 4 | S | `[P1] Add task_id filter to list_agent_reports` |
| 5 | M | `[P1] Add get_task_bundle command for single-call context fetch` |
| 6 | M | `[P1] Add blob-content upload_attachment variant for MCP agents` |
| 7 | M | `[P2] Expose task_skills and task_mcp_tools via IPC` |
| 8 | S | `[P2] Add get_step_log dedicated IPC command` |
| 9 | S | `[P2] delete_attachment should also remove blob from disk` |
| 10 | S | `[P3] Add get_setting / set_setting IPC commands` |
| 11 | S | `[P3] Add optional author guard to update/delete_agent_report` |
| 12 | L | `[P0] E5 — implement real MCP bridge with tool surface` |

Tasks 1-4 are S-size and collectively unblock the minimal autonomous-agent loop in ~1 engineer-day. Task 12 is the prerequisite for any external agent to call any of these commands via the MCP protocol.
