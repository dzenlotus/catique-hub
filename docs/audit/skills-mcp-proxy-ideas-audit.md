# Audit: Skills, MCP Proxy/Passthrough, Ideas Board

**Date:** 2026-05-05
**Auditor:** tech-analyst agent
**Scope:** three under-baked product areas flagged by the maintainer.
**Prior audits (not re-done):** `backend-parity-and-inheritance-audit.md`, `frontend-parity-and-ux-audit.md`, `mcp-contract-and-task-depth-audit.md`.

---

## Area 1 — Skills

**Status: partial** — standalone CRUD is end-to-end; attachment to all 4 levels is half-built; inheritance resolver integration is absent.

---

### Findings

**F-01 (P1) — `board_skills` and `column_skills` join tables do not exist**

`001_initial.sql:214–229` defines `board_prompts` and `column_prompts` but there are no `board_skills`, `column_skills`, `board_mcp_tools`, or `column_mcp_tools` tables anywhere in the migrations. The schema only covers `role_skills` (`001_initial.sql:164–169`) and `task_skills` (`001_initial.sql:186–192`). The prompt hierarchy (board → column → role → task) has no parallel for skills or MCP tools at the board and column levels.

- Current state: board- and column-level skill attachment is structurally impossible.
- Gap: 2 missing join tables + 4 repo functions + 4 IPC commands per entity type (8 tables total across skills + mcp_tools).
- Fix size: M
- Draft task: `[skills] Add board_skills + column_skills schema and repo layer`

**F-02 (P1) — No `list_role_skills` / `list_task_skills` IPC commands**

`crates/api/src/handlers/roles.rs:134–165` exposes `add_role_skill` and `remove_role_skill`. `crates/infrastructure/src/db/repositories/roles.rs:236–302` provides only add/remove mutations — no read path (`fn list_role_skills`, `fn list_role_mcp_tools`). Without a read path, a role editor cannot show which skills are currently attached.

- Current state: write-only (attach/detach) for role_skills and role_mcp_tools; no IPC to read the current set.
- Gap: `list_role_skills`, `list_role_mcp_tools`, `list_task_skills`, `list_task_mcp_tools` — 4 new repo functions + 4 IPC handlers.
- Fix size: S
- Draft task: `[skills] Add list_role_skills / list_task_skills read IPC`

**F-03 (P1) — No task-level skill / MCP tool attachment IPC**

`crates/api/src/handlers/tasks.rs` contains zero references to `skill` or `mcp_tool` (verified by grep). The `task_skills` and `task_mcp_tools` tables exist in schema (`001_initial.sql:186–200`) and have the correct `origin` column, but no Tauri commands (`add_task_skill`, `remove_task_skill`, `add_task_mcp_tool`, `remove_task_mcp_tool`) are registered. The only task-level IPC for skills comes via the `cleanup_role_origin_on_role_delete` trigger cascade (`001_initial.sql:245–251`), which is passive (DELETE only).

- Current state: task-level skill attachment is unreachable from the UI or MCP surface.
- Gap: 4 IPC handlers (add/remove for skills and mcp_tools on tasks).
- Fix size: S
- Draft task: `[skills] Wire add/remove_task_skill and add/remove_task_mcp_tool IPC`

**F-04 (P0) — Frontend has zero attachment wiring for skills or MCP tools on roles**

`src/entities/role/api/rolesApi.ts:107–123` exposes only `addRolePrompt` (123 lines total). There are no `addRoleSkill`, `removeRoleSkill`, `addRoleMcpTool`, `removeRoleMcpTool` functions. The role editor (`src/widgets/role-editor/RoleEditor.tsx`) shows zero references to `skill` or `mcp_tool`. A user cannot attach skills to a role from the UI.

- Current state: backend IPC exists (`crates/api/src/handlers/roles.rs:134–203`) but the frontend never calls it.
- Gap: add skill/MCP attachment to `rolesApi.ts` + role editor UI panel.
- Fix size: M
- Draft task: `[skills] Role editor: attach/detach skills and MCP tools UI`

**F-05 (P1) — Skills do not participate in the inheritance resolver**

`task_skills.origin` column exists (`001_initial.sql:189`) and the delete trigger propagates it (`001_initial.sql:249`), but there is no resolver that propagates `role_id` → `task_skills` rows with `origin='role:…'` on role assignment, and no `column_skills`/`board_skills` exists to propagate down the chain. Prompts have a working resolver path (see `backend-parity-and-inheritance-audit.md`); skills have the schema hooks only.

- Current state: `task_skills.origin` is schema-correct but no business logic populates it from role/column/board.
- Gap: resolver logic in `crates/application/` matching the prompt resolver pattern.
- Fix size: L
- Draft task: `[skills] Implement skill inheritance resolver (role→task propagation)`

**F-06 (P2) — `SkillsPage` sidebar labels items "SKILLS" but `McpToolsPage` labels "MCP SERVERS"**

`src/widgets/mcp-tools-page/McpToolsPage.tsx:34` reads `title="MCP SERVERS"` and `addLabel="Add server"` / `emptyText="No MCP servers yet."` — but the entity is a tool definition, not a server connection. The label drift reflects the unresolved conceptual split (registry vs. proxy).

- Fix size: S
- Draft task: `[mcp] Fix McpToolsPage labels: "MCP SERVERS" → "MCP TOOLS"`

---

### What works well

- Standalone CRUD for both Skills and MCP Tools is fully end-to-end: schema (`001_initial.sql:109–125` + `002_skills_mcp_tools.sql`), repository, use case with validation, Tauri IPC, and React-Query entity layer are all present and tested.
- `task_skills.origin` and `task_mcp_tools.origin` match the `task_prompts.origin` column shape (`001_initial.sql:182,189,196`) — the schema is ready for inheritance.
- Backend role-level add/remove IPC for skills and MCP tools is wired (`crates/api/src/handlers/roles.rs:128–203`).
- `cleanup_role_origin_on_role_delete` trigger (`001_initial.sql:245–251`) is correct for both skills and MCP tools.

---

## Area 2 — MCP Proxy / Passthrough

**Status: placeholder** — `McpTool` is a named schema blob with no URL, no auth, no connection to any external server; the sidecar handles only `ping`/`shutdown`.

---

### Findings

**F-07 (P0) — `McpTool` entity has no URL, auth, or transport fields**

`crates/domain/src/mcp_tool.rs:1–21`: the struct has `id`, `name`, `description`, `schema_json`, `color`, `position`, `created_at`, `updated_at`. There is no `server_url`, `auth_token`, `transport` (stdio/sse/http), or any pointer to an external server. `schema_json` holds a JSON Schema blob for the tool's input — it is a static description, not a connection descriptor.

The `McpToolsPage` sidebar (`src/widgets/mcp-tools-page/McpToolsPage.tsx:34`) calls the entity an "MCP SERVER" but no server connection is modeled. This is the single most damaging gap: the entire vendor-agnostic hub positioning requires that a cat can reach external MCP servers, but today `mcp_tools` is a label table.

- Current state: pure metadata (name + schema blob). No proxy, no registry, no passthrough.
- Gap: ADR-level decision (registry-only vs. passthrough proxy) before any schema migration.
- Fix size: L (ADR) + XL (implementation)
- Draft task: `[mcp] ADR: external MCP server registry vs passthrough proxy model`

**F-08 (P0) — Sidecar implements only `ping` and `shutdown`; no MCP protocol**

`sidecar/index.js:46–57` dispatches `ping` and `shutdown`; all other methods return JSON-RPC `-32601 Method not found`. There is no `@modelcontextprotocol/sdk` import; `sidecar/package.json` should confirm. ADR-0002 (`docs/adr/ADR-0002-mcp-sidecar-architecture.md:8`) explicitly marks the real MCP bridge as E5 work.

- Current state: sidecar is a lifecycle proof-of-concept only.
- Gap: E5 MCP bridge — `@modelcontextprotocol/sdk` integration, tool surface exposure, Rust DB ↔ Node IPC contract.
- Fix size: XL
- Draft task: `[sidecar] E5: integrate @modelcontextprotocol/sdk and expose tool surface`

**F-09 (P1) — No `list_external_tools` or `proxy_call` tool on any MCP surface**

No grep match for `list_external_tools`, `proxy_call`, or `external_tool` anywhere in the codebase (`crates/`, `sidecar/`, `src/`). The proposed ctq-78 vendor-agnostic positioning is not reflected in any existing tool surface.

- Current state: zero external tool routing capability.
- Gap: depends on F-07 (registry model decision).
- Fix size: L
- Draft task: `[mcp] Expose list_mcp_servers and proxy_tool_call in MCP surface`

**F-10 (P1) — `get_task_bundle` does not include skills or MCP tools**

As noted in `mcp-contract-and-task-depth-audit.md`: `get_task_bundle` is not yet implemented. When it is implemented it must include `task_skills` and `task_mcp_tools` rows with their `origin` values. Today there is no `get_task_bundle` handler at all, and no IPC to read `task_skills` or `task_mcp_tools` (see F-03).

- Current state: gap is upstream of skills/MCP — bundle itself is missing.
- Fix size: M (bundle handler) once F-03 is resolved.
- Draft task: `[mcp] Include skills + mcp_tools in get_task_bundle response`

**F-11 (P2) — No ADR for proxy vs registry-only decision**

The two viable models are:

| Model | Fit for positioning | Ops burden | Installer size | Security |
|---|---|---|---|---|
| **Registry-only** (store server URL + auth; cat connects directly) | Good — hub stays stateless relay | Low — no forwarding logic | No change | Cat's runtime holds credentials, not HUB |
| **Pass-through proxy** (sidecar merges external tool lists, routes calls) | Best — truly single tool list | High — sidecar must stay up, handle auth, stream SSE | +Node MCP SDK | HUB holds credentials, single audit point |

For a personal-tool ethos (platform primitives, SQLite-first), **registry-only** is the appropriate starting point: store `(id, name, server_url, transport, auth_json, enabled)` in a new `mcp_servers` table; expose it via `list_mcp_servers` and `get_mcp_server`; let the calling agent connect directly. Passthrough proxy can be layered on in E6+ once the registry pattern is proven.

- Current state: no decision made, no ADR filed.
- Fix size: S (ADR) prerequisite to any implementation.
- Draft task: `[mcp] Write ADR for external MCP server registry-only model (v1)`

---

### What works well

- `McpTool` CRUD (name, description, schema_json, color) is fully wired end-to-end with validation and events.
- The `schema_json` validation (`crates/application/src/mcp_tools.rs:154–160`) rejects non-JSON at the application layer — a useful guardrail even for the future registry model.
- ADR-0002 (`docs/adr/ADR-0002-mcp-sidecar-architecture.md`) correctly scopes the sidecar to lifecycle only and defers the real bridge to E5, preventing premature lock-in.
- Sidecar supervisor (≤ 3 restarts / 60 s policy) is implemented and tested (`crates/sidecar/src/lib.rs`).

---

## Area 3 — Ideas Board / Idea Workflow

**Status: placeholder** — the Ideas board (`k50GpOzFrH1c6dxhzWPmP`) is a generic kanban board with no structured fields, no promotion flow, and no idea-specific entity.

---

### Findings

**F-12 (P1) — No `ideas` table; ideas are generic tasks**

`001_initial.sql:139–150` defines `tasks` with `id, board_id, column_id, slug, title, description, position, role_id, created_at, updated_at`. There is no `idea_type`, `evidence`, `confidence`, `vote_count`, `promoted_to_task_id`, or any discriminating field. The Ideas board is a plain board; its tasks are plain tasks. No code in `src/widgets/board-home/BoardHome.tsx`, `src/widgets/kanban-board/`, or `src/widgets/task-create-dialog/` special-cases the board id `k50GpOzFrH1c6dxhzWPmP`.

- Current state: the Ideas board is a naming convention, not a product feature.
- Gap: decision needed — structured `ideas` table vs. `task_metadata` JSONB extension vs. custom columns.
- Fix size: L
- Draft task: `[ideas] Design idea entity: evidence, confidence, status fields`

**F-13 (P1) — No "promote idea to task" flow**

No function, IPC handler, or UI affordance for converting an idea-task into a PRD task or sub-task exists anywhere in the codebase (verified by grep on `promote`, `convert.*task`, `task.*convert`). There is no cross-board task move API either (`crates/api/src/handlers/tasks.rs` does not expose `move_task_to_board`).

- Current state: a user must manually re-create the task on the target board.
- Gap: `move_task` or `promote_idea` IPC + confirmation dialog.
- Fix size: M
- Draft task: `[ideas] Add "promote idea to task" move-to-board affordance`

**F-14 (P2) — No structured idea fields (evidence, confidence, vote)**

The prior `kanban-frontend-audit.md` does not mention the Ideas board specifically. There are no `evidence`, `confidence`, or `vote` columns in `tasks` or any planned migration. Without structured fields, agents cannot differentiate between an idea with strong evidence and a raw hypothesis.

- Current state: free-text description only.
- Gap: either custom columns or a dedicated `task_metadata` extension.
- Fix size: M
- Draft task: `[ideas] Add evidence + confidence fields to idea-tasks`

**F-15 (P2) — Ideas can only be entered manually; no agent import path**

There is no `create_idea_from_report` IPC or any agent-report-to-idea promotion. `agent_reports` (`001_initial.sql:371–382`) exist and are task-scoped, but there is no workflow that surfaces a report finding as an idea on the Ideas board. Sourcing is 100% manual.

- Current state: manual entry only.
- Gap: agent report → idea creation shortcut.
- Fix size: M
- Draft task: `[ideas] Agent report → create idea on Ideas board shortcut`

---

### Minimum-viable ideas workflow (1–2 paragraphs)

The smallest credible v1 would add a `kind` column (`TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('task','idea')`) to the `tasks` table, plus three nullable metadata columns: `evidence TEXT`, `confidence INTEGER CHECK(confidence BETWEEN 0 AND 100)`, and `promoted_task_id TEXT REFERENCES tasks(id)`. A board flagged `is_ideas_board INTEGER NOT NULL DEFAULT 0` in `boards` would enable the Ideas-board-specific UI path without requiring a separate entity.

On the UI side: the `TaskCreateDialog` would gain an "Idea" toggle when the target board is an ideas board; the `TaskView` would show evidence + confidence fields for idea-tasks and a "Promote to task" button that calls a `promote_idea(idea_id, target_board_id, target_column_id)` IPC command. The MCP surface would gain a `create_idea` tool and a `promote_idea` tool so agents can seed the discovery board from their output. This fits within one sprint and requires no new stateful service, honouring the SQLite-first personal-tool ethos.

---

## Recommended Next Tasks (ordered by ROI)

1. `[skills] Role editor: attach/detach skills and MCP tools UI` (F-04, P0)
2. `[mcp] Write ADR for external MCP server registry-only model (v1)` (F-11, P1)
3. `[skills] Add list_role_skills / list_task_skills read IPC` (F-02, S)
4. `[skills] Wire add/remove_task_skill and add/remove_task_mcp_tool IPC` (F-03, S)
5. `[mcp] Add mcp_servers table: url, transport, auth_json, enabled` (F-07, L)
6. `[mcp] Include skills + mcp_tools in get_task_bundle response` (F-10, M)
7. `[skills] Add board_skills + column_skills schema and repo layer` (F-01, M)
8. `[skills] Implement skill inheritance resolver (role→task propagation)` (F-05, L)
9. `[ideas] Design idea entity: evidence, confidence, status fields` (F-12, L)
10. `[ideas] Add "promote idea to task" move-to-board affordance` (F-13, M)
11. `[mcp] Fix McpToolsPage labels: "MCP SERVERS" → "MCP TOOLS"` (F-06, S)
12. `[ideas] Add evidence + confidence fields to idea-tasks` (F-14, M)
13. `[ideas] Agent report → create idea on Ideas board shortcut` (F-15, M)
14. `[mcp] Expose list_mcp_servers and proxy_tool_call in MCP surface` (F-09, L)
15. `[sidecar] E5: integrate @modelcontextprotocol/sdk and expose tool surface` (F-08, XL)
