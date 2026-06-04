# D-D — Activity log scope and retention

**Status:** Proposed (draft — awaiting product sign-off)
**Phase:** 0 (unblocks Phase 2 space-detail Activity section)
**Surface:** Existing `change_events` table (migration 028) + new read API.

---

## Context

Project Map's `/spaces/:spaceId` page surfaces "Activity log — collapsible, last 20 events, with type filters". `/agents/:agentId` surfaces "Recent activity across all projects — last 20 events with space filter". Today the app emits realtime IPC events (`crates/api/src/events.rs`) but **doesn't persist** a queryable log.

Migration `028_change_events.sql` already exists. Need to confirm what it currently captures and decide what additional events to persist for the v3 UI.

## Options

### What counts as a loggable event?

| Tier | Events | Verdict |
|---|---|---|
| Tier 1 — domain mutations | task created/moved/deleted, board created/deleted, agent attached/detached from space, prompt attached/detached at any scope, attachment uploaded | **Log all** |
| Tier 2 — agent lifecycle | task run started/finished/failed, agent report created, agent report updated | **Log all** |
| Tier 3 — content edits | prompt content edited, role content edited, role display name renamed | **Log compactly** — one row per debounce-window (5 min — matches D-C) so we don't echo every keystroke |
| Tier 4 — config noise | sidecar restarted, MCP server refreshed, providers reconnected | **Do not persist** — these go in the system drawer's session log, not the activity feed |

### Retention

| # | Approach | Pros | Cons |
|---|---|---|---|
| R1 | Keep last N events globally | Simple | Hot space starves cold space |
| R2 | Keep last N days globally (e.g. 90) | Time-aligned with "recent" mental model | Cold spaces lose history they might want |
| R3 | Keep last N per space + last N per agent (cap 1000 each) | Bounded per dimension | Two indexes to maintain |

## Decision

**Tier 1 + Tier 2 + Tier 3 compact, R3 retention (1000 events per space, 1000 per agent, retained 90 days max).**

The 90-day cap is a guard rail against pathologically active workspaces. 1000 events × ~200 bytes JSON = 200 KB per space — trivial.

### Schema (extends existing `change_events`)

The current `change_events` table is good enough for tier-1. Add:

- `scope_kind TEXT NOT NULL` — one of `space | agent | board | task | prompt | skill | mcp_server | global`.
- `scope_id TEXT` — the relevant entity ID (nullable for `global`).
- Index `(scope_kind, scope_id, created_at DESC)` for the per-space and per-agent queries.

Retention is enforced by a daily prune background job:

```rust
fn prune_change_events(conn: &Connection) -> Result<()> {
    conn.execute_batch(r#"
      DELETE FROM change_events WHERE created_at < strftime('%s','now','-90 days')*1000;
      DELETE FROM change_events WHERE id IN (
        SELECT id FROM change_events
        WHERE (scope_kind, scope_id) IN (...)
        ORDER BY created_at DESC LIMIT -1 OFFSET 1000
      );
    "#)?;
    Ok(())
}
```

### New IPC

- `list_activity_for_space(space_id, limit=20, types?: Vec<EventType>) -> Vec<ActivityEntry>`
- `list_activity_for_agent(role_id, limit=20, space_id?: String) -> Vec<ActivityEntry>`
- `list_activity_global(limit=20)` — drives an optional "All activity" debug view.

### Compaction for Tier 3

When a content-edit event fires, look back at the most recent `content_edit` for the same `(scope_kind, scope_id, author?)` within 5 minutes; if found, update its `created_at` and bump a `count` column instead of inserting a new row. The UI renders these as "edited 8 times" rollups.

## Acceptance criteria

- Creating a task emits exactly one `task.created` row in `change_events` with the right `scope_kind/scope_id`.
- Editing a prompt 20 times in 5 minutes produces 1 row with `count = 20`, not 20 rows.
- `list_activity_for_space` returns the last 20 events ordered DESC by `created_at`.
- Prune job removes events older than 90 days; verified by a unit test with seeded backdated rows.
- ts-rs bindings regenerated.

## Open questions

- Where does the prune job run — at app startup, on a tokio interval, or lazily on first read after midnight? Recommendation: app startup + lazy gating. Personal-tool product means a user might leave the app running for weeks; we should not depend on shutdown to clean up.
- Should report-creation events include the report title in the row, or just the FK? Recommendation: just FK; the UI reads `agent_reports.title` on render. Keeps `change_events` slim.

## Out of scope

- Activity log search beyond "by type" filter (Cmd+K reaches reports directly).
- Multi-user attribution (`author` columns) — single-user product.
