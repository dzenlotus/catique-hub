/**
 * `useRecentBoards` — board-id hook consumed by the board surfaces.
 *
 * Refactor-v3 D-F (2026-05): backing store moved from `localStorage`
 * to a dedicated SQLite table (`recent_boards`) via the
 * `@entities/recent-board` slice. The public API of THIS module is a
 * stable `ReadonlyArray<string>` of board ids.
 *
 * `useSidebarCollapsed` still rides on the localStorage shim — that
 * flag is per-install UI state with no FK relationship to any entity,
 * so D-F left it on the existing `appShellPrefs` surface.
 */
import { useMemo, useSyncExternalStore } from "react";

import { useRecentBoards as useRecentBoardsQuery } from "@entities/recent-board";

import {
  readSidebarCollapsed,
  subscribeSidebarCollapsed,
} from "./appShellPrefs";

const EMPTY_ARRAY: ReadonlyArray<string> = Object.freeze([]);

/**
 * Read-only list of recently-visited board ids (most-recent first).
 * Returns the frozen empty array while the query is pending or errored,
 * so consumers never have to handle `undefined`.
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
