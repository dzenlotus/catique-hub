/**
 * Boards query-cache layer.
 *
 * Built on `@tanstack/react-query`. The decision (vs ad-hoc useState +
 * useEffect + Context) is documented in `src/shared/ui/README.md`:
 * react-query gives us request deduplication, cache-invalidation on
 * mutation, refetch on focus, and built-in `isPending` / `isError`
 * states — all behaviours we'd otherwise hand-roll across every entity
 * slice. Shipping it once at E2.3 means E2.4+ entity slices (Space,
 * Column, Task) reuse the pattern.
 *
 * Convention:
 * - Query keys are tuples starting with the entity name, e.g.
 *   `['boards']` for the list and `['boards', id]` for a single record.
 * - The mutation hooks invalidate the list key on success so any
 *   mounted `useBoards()` re-fetches automatically.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createBoard,
  getBoard,
  listBoards,
  updateBoard,
  type CreateBoardArgs,
  type UpdateBoardArgs,
} from "../api";
import type { Board } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const boardsKeys = {
  all: ["boards"] as const,
  list: () => [...boardsKeys.all] as const,
  detail: (id: string) => [...boardsKeys.all, id] as const,
};

/**
 * `useBoards` — list every board across all spaces.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`) rather than
 * sniffing `result.data === undefined`.
 */
export function useBoards(): UseQueryResult<Board[], Error> {
  return useQuery({
    queryKey: boardsKeys.list(),
    queryFn: listBoards,
  });
}

/**
 * `useBoard` — fetch a single board. Disabled when `id` is empty so
 * mounting the hook with no selection doesn't fire an IPC call.
 */
export function useBoard(id: string): UseQueryResult<Board, Error> {
  return useQuery({
    queryKey: boardsKeys.detail(id),
    queryFn: () => getBoard(id),
    enabled: id.length > 0,
  });
}

/**
 * `useCreateBoardMutation` — create a board, then invalidate the list
 * cache so any mounted `useBoards()` re-fetches.
 *
 * The hook returns the full `UseMutationResult` so call-sites can read
 * `mutation.isPending` / `mutation.error` directly. Use `.mutate()` for
 * fire-and-forget; `.mutateAsync()` to await.
 */
export function useCreateBoardMutation(): UseMutationResult<
  Board,
  Error,
  CreateBoardArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBoard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.list() });
    },
  });
}

/**
 * `useUpdateBoardMutation` — partial-update a board, then invalidate the
 * list cache and the specific detail entry so all mounted consumers
 * re-fetch automatically.
 *
 * Mirrors `useCreateBoardMutation` shape and follows the same pattern as
 * `useUpdateSpaceMutation` in `entities/space/model/store.ts`.
 */
export function useUpdateBoardMutation(): UseMutationResult<
  Board,
  Error,
  UpdateBoardArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBoard,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: boardsKeys.detail(updated.id),
      });
    },
  });
}
