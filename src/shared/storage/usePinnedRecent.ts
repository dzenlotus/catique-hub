/**
 * `usePinnedBoards` + `useRecentBoards` — board-id hooks consumed by
 * `widgets/spaces-sidebar` and `widgets/app-sidebar`.
 *
 * Refactor-v3 D-F (2026-05): backing store moved from `localStorage`
 * to dedicated SQLite tables (`pinned_boards`, `recent_boards`) via the
 * `@entities/pinned-board` / `@entities/recent-board` slices. The
 * public API of THIS module is preserved (`ReadonlyArray<string>` of
 * board ids) so existing callers — Stream L's `AppSidebar`, the
 * `SpacesSidebar` kebab — keep compiling without a signature change.
 *
 * Internally we now wrap the TanStack-Query hooks from the entity
 * slices and project their `Board[]` payload down to a stable
 * `string[]` of ids.
 *
 * `useSidebarCollapsed` still rides on the localStorage shim — that
 * flag is per-install UI state with no FK relationship to any entity,
 * so D-F left it on the existing `appShellPrefs` surface.
 */
import { useMemo, useSyncExternalStore } from "react";

import { usePinnedBoards as usePinnedBoardsQuery } from "@entities/pinned-board";
import { useRecentBoards as useRecentBoardsQuery } from "@entities/recent-board";

import {
  readSidebarCollapsed,
  subscribeSidebarCollapsed,
} from "./appShellPrefs";

const EMPTY_ARRAY: ReadonlyArray<string> = Object.freeze([]);

/**
 * Read-only list of pinned board ids. Returns the frozen empty array
 * while the underlying query is pending or has errored — same defensive
 * default the old localStorage version surfaced when the slot was
 * unset, so consumers never have to handle `undefined`.
 */
export function usePinnedBoards(): ReadonlyArray<string> {
  const query = usePinnedBoardsQuery();
  // Memo on the underlying `data` reference so a re-render that didn't
  // change the array doesn't allocate a new wrapper — keeps downstream
  // `useMemo(() => new Set(ids), [ids])` callers stable.
  return useMemo(() => {
    if (query.data === undefined) return EMPTY_ARRAY;
    if (query.data.length === 0) return EMPTY_ARRAY;
    return query.data.map((b) => b.id);
  }, [query.data]);
}

/**
 * Read-only list of recently-visited board ids (most-recent first).
 * Same defensive empty-array default as [`usePinnedBoards`].
 */
export function useRecentBoards(): ReadonlyArray<string> {
  const query = useRecentBoardsQuery();
  return useMemo(() => {
    if (query.data === undefined) return EMPTY_ARRAY;
    if (query.data.length === 0) return EMPTY_ARRAY;
    return query.data.map((b) => b.id);
  }, [query.data]);
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(
    subscribeSidebarCollapsed,
    readSidebarCollapsed,
    () => false,
  );
}
