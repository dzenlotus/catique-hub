# D-C — Version history for role.content and prompt.content

**Status:** Proposed (draft — awaiting product sign-off)
**Phase:** 0 (unblocks Phase 4 history/diff/revert)
**Surface:** Two new tables (`role_content_versions`, `prompt_content_versions`); application hooks; new IPC.

---

## Context

Project Map open issue #5. The map calls for git-like history on the two long-form text fields: `role.content` (agent instructions) and `prompt.content`. "I accidentally erased half my instruction — where's undo?" is the unmistakable trigger.

Two axes:

- **Granularity** — save every keystroke / every save / debounced.
- **Retention** — how many versions to keep.

## Options

### Granularity

| # | Approach | Pros | Cons |
|---|---|---|---|
| G1 | Snapshot on every save (every IPC mutation) | Simple — no timer state | Active editing produces 50+ versions/hour; storage bloat |
| G2 | Debounce — one version per 5 min of active edits, or one per explicit "save" | Versions correlate with mental checkpoints | Requires tracking "edit session start" in app layer |
| G3 | Diff-compressed (store base + diffs) | Storage-efficient | Reconstruction cost on revert; tooling not built in Rust |

### Retention

| # | Approach | Pros | Cons |
|---|---|---|---|
| R1 | Keep last N (e.g. 50) | Predictable storage | Old history lost |
| R2 | Keep last N days (e.g. 30) | Time-aligned mental model | Hot files can churn through history fast |
| R3 | Unlimited | Never lose anything | Storage unbounded |

## Decision

**G2 + R1 (last 50 versions per row, debounced by 5 min).**

Rationale: a personal-tool product running on a single user's laptop. Storage is cheap until it isn't, but 50 versions per role × 50 roles × ~20 KB content = 50 MB ceiling — well within SQLite WAL comfort. 5-min debounce matches typical "I've been editing for a while, this is a meaningful checkpoint" mental rhythm without polluting history with rapid-fire saves from autosave UI.

### Schema

```sql
CREATE TABLE role_content_versions (
  id          TEXT PRIMARY KEY,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  author_note TEXT  -- optional, future use (e.g. revert reason)
);
CREATE INDEX idx_role_content_versions_role_created
  ON role_content_versions(role_id, created_at DESC);

-- analogous: prompt_content_versions
```

### Hook

`update_role(content: ...)` and `update_prompt(content: ...)` use cases check the last version's `created_at`:

- If older than `5 minutes` → insert new version row with the **previous** content (the one being overwritten).
- Else → no-op (the previous version still represents the start of this editing session).

On insert, prune the oldest rows beyond `N=50` for that `role_id` / `prompt_id`.

### IPC

- `list_role_versions(role_id)` → `Vec<RoleContentVersion>` (id, created_at, preview).
- `get_role_version(version_id)` → full content.
- `revert_role_to_version(version_id)` → calls `update_role` with the version's content; the revert itself creates a new version (the act of reverting is a save).

Parallel calls for prompts.

## Acceptance criteria

- Editing a role 10 times within 5 minutes produces 1 version row (not 10).
- Editing a role over the course of an hour with ≥1 edit per 5-min window produces ≤12 version rows.
- 51st version triggers deletion of the oldest version row.
- Revert sets `role.content` to the historical value and pushes the pre-revert content onto the version stack.
- ts-rs bindings regenerated.

## Open questions

- Should `revert` also preserve the version that's being reverted to? Recommendation: yes — see AC-5; revert is bidirectional ("oh wait, I needed the new one").
- Show diffs in markdown chunks or character-level? Recommendation: line-level — matches typical mental model and is cheap to compute in JS.

## Out of scope

- Branching history (the v3 product is single-user, single-machine; linear history is enough).
- Per-version comments / commit messages (the `author_note` column is reserved for revert annotations only).
