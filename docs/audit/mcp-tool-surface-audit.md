# Audit: Catique HUB MCP Tool Surface (post-ADR-0008)

**Date:** 2026-05-13
**Branch baseline:** `catique/audit-roadmap-spike` HEAD = `ef63085`
**Driving question:** Which Catique HUB MCP tools belong on the external surface (the one Claude Code / Codex / OpenCode reach via the sidecar), which to remove or consolidate, and what's missing for the per-role retrospective memory (ctq-137).

---

## 1. Surface today (5 read-only tools)

Defined in `sidecar/tool-manifest.json` + `crates/api/src/mcp_bridge/mod.rs::dispatch`. Survived PROXY-S1..S7 deliberately: read-only, Catique-native, no schema mutation.

| Tool | Use case | Verdict |
|---|---|---|
| `list_boards` | `BoardsUseCase::list` | **Keep** — basic state probe. |
| `list_columns` | `ColumnsUseCase::list` | **Keep**, but see §3 (could fold into `list_boards` as a nested shape). |
| `list_tasks` | `TasksUseCase::list` | **Keep** — but unbounded; needs filter args (§3). |
| `get_task` | `TasksUseCase::get` | **Keep** — load-bearing for the agent. |
| `get_task_bundle` | `TasksUseCase::resolve_task_bundle` | **Keep** — the one tool that materialises the full agent context (role + inherited prompts + MCP tools). |

Plus three **internal** supervisor-channel arms (Node→Rust, not in the external `tools/list`):
- `list_proxied_tools` — Node's dynamic registry on startup.
- `resolve_keychain` — per-call secret fetch.
- `proxy_tool_call` — async path for relayed upstream calls.

Internal arms are correct as-is. The audit below targets the **external** surface.

---

## 2. Promptery's legacy tool set — what NOT to copy verbatim

The Promptery MCP server (`mcp__promptery__*` namespace; reachable from this Claude Code session) ships ~80 tools. Catique HUB inherits the *data model* from Promptery, not the tool surface. Copying the Promptery surface verbatim would re-introduce the entire pre-ADR-0008 confusion — many of those tools are schema CRUD (create/update/delete boards, roles, columns, spaces, tags, prompt-groups) that the user drives via the UI.

### Categorisation against the Catique product model

| Promptery category | Promptery count | Catique HUB verdict |
|---|---|---|
| **CRUD on boards / columns / spaces / tags / prompt-groups / roles / mcp-tools / skills** | ~40 tools (`create_*`, `update_*`, `delete_*`) | **Remove from external MCP.** User-driven via UI; agents do not create schema. Keep Tauri IPC (UI consumes), strip from external surface. |
| **Read-only state queries** (`list_*`, `get_*`) | ~15 tools | **Consolidate.** A small set (boards / columns / tasks / get_task / get_task_bundle / list_roles / list_skills / list_tags) covers what the agent actually queries. |
| **Task lifecycle** (`create_task`, `update_task`, `move_task`, `add_task_prompt`, `set_task_role`) | ~10 tools | **Keep, consolidated.** Agents legitimately create tasks (decomposition), update them (progress), move them between columns. Need 4 tools max — split per concern: `create_task` / `update_task` / `move_task` / `attach_to_task`. |
| **Reports** (`create_agent_report`, `list_agent_reports`, `get_agent_report`, `search_agent_reports`) | 4 tools | **Keep all 4.** First-class artefact for typed agent output (memo / summary / investigation / etc.). |
| **Prompt assembly** (`add_prompt_to_group`, `set_role_prompts`, `set_board_role`, …) | ~8 tools | **Remove.** Wiring is user/UI work; agents should not rewire role-prompt graphs. |
| **UI control** (`open_promptery_ui`, `get_ui_info`) | 2 tools | **Remove.** Cross-process UI orchestration is out of scope for the external agent surface. |
| **Search** (`search_tasks`, `search_agent_reports`) | 2 tools | **Keep.** Critical for the agent to recall prior work. |

**Bottom line: Promptery exposes ~80 MCP tools; Catique HUB's target external surface is ~15.**

---

## 3. Recommended target surface for v1.0

### 3.1 Keep + extend (Catique-native, already present)

| Tool | Status | Change |
|---|---|---|
| `list_boards` | live | Add optional `space_id` filter. |
| `list_columns` | live | Add optional `board_id` filter (currently returns ALL columns workspace-wide — too big on real data). |
| `list_tasks` | live | **Add filters**: `board_id`, `column_id`, `role_id`, `status` (when status lands), `limit` (default 50). Unbounded reads on a 10k-task DB blow the LLM context window. |
| `get_task` | live | Keep. |
| `get_task_bundle` | live | Keep. Document that this is the canonical "load context" call agents should make BEFORE `proxy_tool_call`-ing anything. |

### 3.2 Add — task lifecycle (agents writing back to the DB)

| Tool | Use-case it dispatches to | Why |
|---|---|---|
| `create_task` | `TasksUseCase::create` | Agent decomposes a high-level task into sub-tasks. Currently agents have NO way to write — they must dictate the structure to the user, who then re-types into UI. |
| `update_task` | `TasksUseCase::update` | Mid-work status updates, description edits. |
| `move_task` | `TasksUseCase::route_to_board` / column-set IPC | Agent flips status by moving the card. |
| `attach_prompt_to_task` | existing IPC | Lets the agent pin a relevant prompt to a task it's working on. |

These four cover 95% of what an agent legitimately writes. Everything else (create_role, create_board, schema rewiring) stays user-only.

### 3.3 Add — reports (typed retrospectives + investigation logs)

| Tool | Use-case | Why |
|---|---|---|
| `create_agent_report` | `AgentReportsUseCase::create` | Agent persists `investigation / analysis / plan / summary / review / memo`. Already a first-class entity in Promptery; mirror into Catique. |
| `list_agent_reports` | … | Agent recalls past reports on this task or this role. |
| `get_agent_report` | … | Full body read. |
| `search_agent_reports` | FTS5 over `agent_reports.content` | Recall by free-text. |

### 3.4 Add — search

| Tool | Use-case | Why |
|---|---|---|
| `search_tasks` | FTS5 over `tasks_fts` (Phase 1 P1-T6 of ctq-73 already plans this) | Recall by free-text across all tasks. Bounded by `space_id` + `role_id` per ADR. |

### 3.5 Add — per-role retrospective memory (ctq-137 — this round)

| Tool | Use-case | Why |
|---|---|---|
| `recall_role_notes` | new `RoleNotesUseCase::recall(role_id, tags?, query?, limit?)` | Agent loads its own past retrospectives at the start of a task. |
| `add_role_note` | new `RoleNotesUseCase::add(role_id, body, tags[], source_task_id?)` | Agent writes a retrospective at the end of a task. |
| `list_role_tags` | new `RoleNotesUseCase::list_tags(role_id)` | Agent inspects the available tag cloud before deciding which tags to use for the new note (encourages reuse over invention). |

### 3.6 Remove / never expose externally

| Promptery tool | Why not |
|---|---|
| `create_role`, `delete_role`, `update_role` | Schema CRUD = user UI. |
| `create_space`, `delete_space`, `update_space` | Same. |
| `create_board`, `delete_board`, `update_board`, `move_board_to_space` | Same. |
| `create_column`, `delete_column`, `update_column` | Same. |
| `create_skill`, `delete_skill`, `update_skill` | Same. |
| `create_mcp_tool`, `delete_mcp_tool`, `update_mcp_tool` | Same — MCP servers are configured in UI; tools auto-introspect. |
| `create_prompt`, `delete_prompt`, `update_prompt`, `create_prompt_group`, `delete_prompt_group`, `update_prompt_group`, `reorder_prompt_groups` | Prompts are the user's library; agents read, don't rewrite. |
| `add_prompt_to_group`, `remove_prompt_from_group`, `set_group_prompts`, `add_prompt_to_tag`, `remove_prompt_from_tag`, `set_tag_prompts`, `set_role_prompts`, `set_board_prompts`, `set_column_prompts`, `set_board_role`, `set_column_role`, `set_task_role`, `set_task_prompt_override` | Wiring graph mutations = user UI. |
| `create_tag`, `delete_tag`, `update_tag` | Schema CRUD. NB: ctq-137 role-note tags are a SEPARATE concept; they live on `role_notes`, not on `tags`. |
| `list_task_attachments` | Subsumed by `get_task_bundle` (already returns attachment metadata). |
| `move_task_with_resolution` | Edge case; if needed, fold into `move_task` with an optional `resolution` arg. |
| `open_promptery_ui`, `get_ui_info` | UI is user-controlled. |

### 3.7 Consolidate

| Old (Promptery shape) | New (Catique target) |
|---|---|
| `list_boards` + `list_columns` (separate) | **Keep both**, but add `?include_columns=true` to `list_boards` for one-shot tree fetch. |
| `get_task` + `list_task_attachments` + `get_task_context` | **Already covered by `get_task_bundle`** — single load-bearing call. |
| `add_task_prompt` + `remove_task_prompt` + `add_task_mcp_tool` + `remove_task_mcp_tool` + `add_task_skill` + `remove_task_skill` | **Collapse into** `attach_to_task(task_id, kind, id)` / `detach_from_task(task_id, kind, id)` where `kind ∈ {prompt, mcp_tool, skill}`. |
| `move_task` + `move_task_with_resolution` | **Single** `move_task(id, column_id, resolution?)`. |

### Target count

5 (current) + 4 (lifecycle) + 4 (reports) + 1 (search) + 3 (role notes) - 0 (no removes since current 5 stay) = **~17 tools**. Up from 5 today, but down ~80% from the Promptery legacy.

---

## 4. Open questions / phasing

1. **MEM tools vs reports.** `add_role_note` overlaps superficially with `create_agent_report`. Recommendation: ship both. Reports are per-task typed artefacts the user reads; notes are per-role memory the agent consults. Different surface, different lifetime — already argued in ctq-137.
2. **Role-note tag reuse signal.** Agents tend to invent slightly-different versions of the same tag (`async-trait`, `async_trait`, `async-trait-on-tauri`). Mitigation: `list_role_tags` returns the existing cloud BEFORE the agent invents new ones; the use-case normalises tag values (kebab-case, max 32 chars).
3. **Phasing.** Ship in this order:
   - **Round 1 (this commit chain):** ctq-137 implementation = `role_notes` + `role_note_tags` schema + 3 MCP tools (`recall_role_notes`, `add_role_note`, `list_role_tags`) + Settings page.
   - **Round 2:** lifecycle tools (`create_task`, `update_task`, `move_task`, `attach_to_task`).
   - **Round 3:** reports (`create_agent_report` etc.) + search (`search_tasks`, `search_agent_reports`).
   - **Round 4:** filter args on existing reads (`list_tasks` filter, `list_boards` include-columns).
4. **Auto-trigger retrospective.** Should the UI prompt the user to "run retrospective" after a rating? Out of scope for round 1; v1 is: agent decides when to write notes, per role-file instruction.

---

## 5. Recommendations

1. **Implement ctq-137 now** as the next commit chain (this audit + 2-sub-agent dispatch).
2. **Update `sidecar/tool-manifest.json`** with the three new memory tools in the same round.
3. **Add a paragraph to `render_md_agent`** documenting the memory contract: "before starting a task call `recall_role_notes`; after completing it call `add_role_note` with the user-visible retrospective and tags drawn from `list_role_tags` first".
4. **Defer rounds 2-4** to subsequent commits; each is its own scoping task.
5. **Track this audit as `ctq-138`** on `Discovery` so the phased rollout has a single home.
