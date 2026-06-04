# Refactor v3 — index

Refactor driven by [`Project_map.md`](../../Project_map.md). Plan and phasing in [`../refactor-v3-plan.md`](../refactor-v3-plan.md). Tracking branch: `refactor-v3-projectmap`.

## Phase 0 decisions

| ID | Decision | Status |
|---|---|---|
| [D-A](decisions/D-A-override-semantics-skills-integrations.md) | Override semantics — extend prompt overrides to replace-OR-suppress; add skill + integration overrides | Proposed |
| [D-B](decisions/D-B-effective-counter-denormalization.md) | Denormalize effective-context counter on `tasks` row | Proposed |
| [D-C](decisions/D-C-version-history-granularity.md) | Version history for `role.content` and `prompt.content` — 5-min debounce, last 50 versions | Proposed |
| [D-D](decisions/D-D-activity-log-scope-retention.md) | Activity log — tier 1+2+3 events, 1000 per scope, 90-day prune | Proposed |
| [D-E](decisions/D-E-legacy-route-redirect-resolver.md) | Legacy route lookup-redirect resolver | Proposed |
| [D-F](decisions/D-F-pinned-recent-persistence.md) | Pinned / Recent boards persistence + `kv_settings` for singletons | Proposed |
| [D-G](decisions/D-G-board-owner-data-audit.md) (+ [audit report](decisions/audit-D-G-report.md)) | Boards-without-owner audit | Audit clean locally; defer migration unless collaborator data flags it |

## Next phase

Phase 1 — navigation skeleton. See plan §"Phase 1".
