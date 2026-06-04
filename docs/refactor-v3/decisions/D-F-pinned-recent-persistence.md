# D-F — Pinned and Recent boards persistence

**Status:** Proposed (draft — awaiting product sign-off)
**Phase:** 0 (unblocks Phase 1 sidebar sections)
**Surface:** Two new tables (`pinned_boards`, `recent_boards`); IPC; sidebar widget.

---

## Context

Project Map sidebar has two sections above the main spaces list:

- **Pinned boards** — user opt-in, manually managed, no cap.
- **Recent boards (5)** — LRU, auto-tracked on board open.

Both persist per-install (not per-space). They survive app restarts.

Same need for `last_active_space` (Phase 1 Home redirect): a single key telling us where to send the user on app launch.

## Options

| # | Approach | Pros | Cons |
|---|---|---|---|
| 1 | Frontend-only `localStorage` | Zero backend work | Doesn't survive `__E2E_RESET__`; lost on disk migration; can't sync across windows |
| 2 | Generic `kv_settings(key, value)` table | One table for all per-install state (pinned, recent, last_active_space, sidebar_collapsed, theme...) | Untyped — bugs leak as silent JSON parse failures |
| 3 | Dedicated tables (`pinned_boards`, `recent_boards`, plus `app_state` for singletons) | Strong typing; FK enforcement to `boards.id` | More tables |

## Decision

**Option 3** for entity-linked state, **Option 2** for singletons.

Rationale: `pinned_boards` and `recent_boards` reference `boards.id` — they need ON DELETE CASCADE so a deleted board disappears from both lists. A loose `kv_settings` row couldn't enforce that without application-layer fixups on every board delete.

Singletons (`last_active_space_id`, `sidebar_collapsed`, `theme`, …) go in `kv_settings(key TEXT PK, value TEXT)` because they don't reference entities and the value shape varies.

### Schemas

```sql
CREATE TABLE pinned_boards (
  board_id   TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  position   REAL NOT NULL,
  pinned_at  INTEGER NOT NULL
);

CREATE TABLE recent_boards (
  board_id   TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL
);
CREATE INDEX idx_recent_boards_visited ON recent_boards(visited_at DESC);

CREATE TABLE kv_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Recent eviction

On every `track_board_visit(board_id)`:

1. UPSERT into `recent_boards` with `visited_at = now`.
2. After insert, run `DELETE FROM recent_boards WHERE board_id NOT IN (SELECT board_id FROM recent_boards ORDER BY visited_at DESC LIMIT 5)` — keeps the table at ≤5 rows.

### Pinned reordering

Drag-to-reorder uses a `position` float (existing convention from `boards.position`). New pin gets `max(position) + 1`. Drag computes a fractional midpoint per existing helper.

### IPC

- `list_pinned_boards() -> Vec<Board>` (ordered by `position` ASC)
- `pin_board(board_id)` / `unpin_board(board_id)` / `reorder_pinned(board_id, new_position)`
- `list_recent_boards() -> Vec<Board>` (ordered by `visited_at` DESC, capped 5)
- `track_board_visit(board_id)` — fire-and-forget on every board open
- `get_setting(key) -> Option<String>` / `set_setting(key, value)` — already exist as `mcp__catique-hub__get_setting / set_setting` per the MCP tool list

## Acceptance criteria

- Pin a board → sidebar shows it in Pinned section after invalidate.
- Delete a board → it disappears from both Pinned and Recent within the same tick (CASCADE).
- Opening 7 boards in sequence → Recent shows the last 5; oldest two are evicted.
- `last_active_space_id` survives app restart.
- ts-rs bindings regenerated.

## Open questions

- Should `recent_boards` be per-space (5 per space) instead of global (5 total)? Recommendation: global. Sidebar is a global surface; per-space recents belong on the space-detail Resume panel (different concern).
- Pinned cap? Recommendation: none. Sidebar scrolls; users self-regulate.

## Out of scope

- Multi-install sync (single-machine product).
- Pinned tasks / pinned prompts — out of scope for v3; only boards qualify because they're the navigational anchor.
