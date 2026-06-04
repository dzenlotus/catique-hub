/**
 * Recent-boards query-cache layer (refactor-v3 D-F).
 *
 * Mirrors `entities/pinned-board/model/store.ts` shape. Mutation hook
 * invalidates the list cache so the AppSidebar's Recent section
 * re-renders the moment a board is opened.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { clearRecentBoards, listRecentBoards, trackBoardVisit } from "../api";
import type { Board } from "@bindings/Board";

/** Query-key factory. */
export const recentBoardsKeys = {
  all: ["recent_boards"] as const,
  list: () => [...recentBoardsKeys.all] as const,
};

/**
 * `useRecentBoards` — list up to 5 recently-visited boards joined with
 * the `boards` table, ordered by `visited_at` DESC.
 */
export function useRecentBoards(): UseQueryResult<Board[], Error> {
  return useQuery({
    queryKey: recentBoardsKeys.list(),
    queryFn: listRecentBoards,
  });
}

/**
 * `useTrackBoardVisitMutation` — record a visit. Fire-and-forget from
 * KanbanBoard `useEffect` so the Recent section moves the board to the
 * top of the LRU.
 */
export function useTrackBoardVisitMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: trackBoardVisit,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recentBoardsKeys.list() });
    },
  });
}

/**
 * `useClearRecentBoardsMutation` — wipe the Recent LRU. Backs the
 * AppSidebar's "Clear" affordance. Invalidates the list cache on
 * success so the section disappears in the same render tick.
 */
export function useClearRecentBoardsMutation(): UseMutationResult<
  void,
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearRecentBoards,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recentBoardsKeys.list() });
    },
  });
}
