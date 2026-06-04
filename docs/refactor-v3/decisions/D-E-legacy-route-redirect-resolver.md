# D-E — Legacy route lookup-redirect resolver

**Status:** Proposed (draft — awaiting product sign-off)
**Phase:** 0 (unblocks Phase 1 routing changes)
**Surface:** `src/app/routes.ts`, new `src/app/router/legacy-redirect.tsx`, `src/e2e/bridge/handlers/legacy.ts`.

---

## Context

Project Map open issue #7. The v3 sidebar surfaces `/agents`, `/integrations`, and `/spaces/:spaceId/boards/:boardId`. Today the app uses `/roles`, `/mcp-servers`, and `/boards/:boardId` for the same entities. Existing user bookmarks must keep resolving.

A trivial config-alias (`{ "/roles": "/agents" }`) is **not enough** for the board case: `/boards/:boardId` doesn't carry the `spaceId`, so the redirect resolver must look up the space the board belongs to.

## Options

| # | Approach | Pros | Cons |
|---|---|---|---|
| 1 | Permanent legacy paths (no redirect) | Zero work | Two URL surfaces forever; analytics noise; deep-link ambiguity |
| 2 | Config alias (`Map<oldPath, newPath>`) | Easy | Breaks for `/boards/:id` — needs runtime board → space lookup |
| 3 | Resolver component — reads param from URL, queries TanStack-cache or IPC, sets `location` to the canonical path | Handles dynamic redirects; one-place implementation | Async resolve → flash of loading state |

## Decision

**Option 3** with a small UX safeguard: render a 1-line "redirecting…" placeholder for ≤200 ms before falling through to a 404.

### Mapping

| Legacy | Canonical | Resolver |
|---|---|---|
| `/roles` | `/agents` | static |
| `/roles/:roleId` | `/agents/:agentId` | static, `agentId = roleId` |
| `/mcp-servers` | `/integrations` | static |
| `/mcp-servers/:serverId` | `/integrations/:serverId` | static |
| `/mcp-servers/:serverId/tools/:toolId` | `/integrations/:serverId/tools/:toolId` | static |
| `/mcp-tools` | `/integrations` | static (already exists as `mcpServersLegacy`, extend) |
| `/boards/:boardId` | `/spaces/:spaceId/boards/:boardId` | **dynamic** — lookup space via `get_board(boardId).space_id` |
| `/boards/:boardId/settings` | `/spaces/:spaceId/boards/:boardId/settings` | dynamic |
| `/tasks/:taskId` | unchanged (`/tasks/:taskId` stays canonical — task is global) | n/a |

### Implementation sketch

```tsx
// src/app/router/legacy-redirect.tsx
export function LegacyBoardRedirect() {
  const [, params] = useRoute("/boards/:boardId");
  const boardId = params?.boardId;
  const { data: board, isLoading } = useBoard(boardId);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (board) setLocation(`/spaces/${board.space_id}/boards/${board.id}`, { replace: true });
  }, [board, setLocation]);

  if (isLoading) return <RedirectingPlaceholder />;
  if (!board) return <NotFound entity="board" id={boardId} />;
  return null;
}
```

Lifetime: one release after Phase 6 ships. After that, telemetry-driven removal — if `legacy-redirect-hit` events drop below 1% of route activations for two weeks, remove the resolver.

### E2E bridge

`src/e2e/bridge/handlers/legacy.ts` doesn't need a handler — the redirect is a frontend-only rewrite. Existing `boards.get` handler serves the lookup. Verify in `e2e/specs/legacy-redirect.spec.ts`.

## Acceptance criteria

- `/roles` from a fresh tab navigates the user to `/agents` and stays there.
- `/boards/abc123` (where `abc123` belongs to space `space-1`) navigates to `/spaces/space-1/boards/abc123`.
- `/boards/nonexistent` shows `NotFound` after 200 ms, not a redirect loop.
- Browser back button after redirect returns the user to where they came from, not the legacy URL (use `replace: true`).
- Cmd+K and sidebar always emit canonical URLs.

## Open questions

- Should legacy paths emit a console warning in dev mode? Recommendation: yes — helps catch internal callers still building legacy URLs.
- Track redirect counts via the existing event channel for telemetry? Recommendation: yes — one event per redirect, scope_kind `global`, type `legacy_redirect_hit`.

## Out of scope

- Permanent removal date — depends on telemetry.
- Legacy-to-canonical rewriting in committed code (we want grep-able URLs in source).
