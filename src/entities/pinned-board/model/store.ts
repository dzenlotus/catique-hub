/**
 * Pinned-boards query-cache layer (refactor-v3 D-F).
 *
 * Same shape as `entities/board/model/store.ts`: query-key factory +
 * read hook + mutation hooks that invalidate the list cache. Single
 * source of truth for the AppSidebar's Pinned section; legacy
 * localStorage callers (`@shared/storage/usePinnedRecent`) now forward
 * here so signatures stay stable.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  listPinnedBoards,
  pinBoard,
  unpinBoard,
  reorderPinned,
} from "../api";
import type { Board } from "@bindings/Board";

/** Query-key factory. Single root so invalidation cascades cleanly. */
export const pinnedBoardsKeys = {
  all: ["pinned_boards"] as const,
  list: () => [...pinnedBoardsKeys.all] as const,
};

/**
 * `usePinnedBoards` — list every pinned board joined against the
 * `boards` table, ordered by `position` ASC.
 */
export function usePinnedBoards(): UseQueryResult<Board[], Error> {
  return useQuery({
    queryKey: pinnedBoardsKeys.list(),
    queryFn: listPinnedBoards,
  });
}

/**
 * `usePinBoardMutation` — pin a board, then invalidate the list cache.
 * The Rust side is idempotent so calling this on an already-pinned
 * board is a silent no-op.
 */
export function usePinBoardMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: pinBoard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pinnedBoardsKeys.list() });
    },
  });
}

/**
 * `useUnpinBoardMutation` — unpin a board, then invalidate the list
 * cache. Idempotent on the server.
 */
export function useUnpinBoardMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unpinBoard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pinnedBoardsKeys.list() });
    },
  });
}

export interface ReorderPinnedArgs {
  boardId: string;
  newPosition: number;
}

/**
 * `useReorderPinnedMutation` — move a pinned row to `newPosition`. The
 * caller picks the fractional midpoint between the two neighbours it
 * wants the row to land between.
 */
export function useReorderPinnedMutation(): UseMutationResult<
  void,
  Error,
  ReorderPinnedArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, newPosition }) => reorderPinned(boardId, newPosition),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pinnedBoardsKeys.list() });
    },
  });
}

/**
 * `useReorderPinnedListMutation` — renumber the entire pinned list to
 * a canonical `1.0, 2.0, 3.0, …` sequence by issuing one
 * `reorder_pinned` call per row.
 *
 * Round 4 / Stream O (AppSidebar drag-reorder): the single-row
 * `useReorderPinnedMutation` requires the caller to know the
 * neighbours' fractional positions, which `list_pinned_boards` does
 * not expose (returns plain `Board` rows whose `position` is
 * `boards.position`, not `pinned_boards.position`). Renumbering the
 * full list after every drag keeps positions monotonic integers so
 * the next drag can compute its midpoint from array indices alone.
 *
 * Trade-off: N IPC round-trips per drop. The pinned section caps at
 * ~5-10 rows in practice, so N stays small.
 */
export function useReorderPinnedListMutation(): UseMutationResult<
  void,
  Error,
  ReadonlyArray<string>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: ReadonlyArray<string>) => {
      // Sequential rather than parallel: SQLite is single-writer, and
      // serialising the calls here keeps the IPC layer's connection
      // contention low. The full list normally fits in a single
      // millisecond round-trip per row.
      for (let i = 0; i < orderedIds.length; i += 1) {
        await reorderPinned(orderedIds[i]!, i + 1);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pinnedBoardsKeys.list() });
    },
  });
}
