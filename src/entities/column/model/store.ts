/**
 * Columns query-cache layer.
 *
 * Same shape as `entities/board/model/store.ts` — react-query for
 * cache + invalidation. Query keys are scoped by `boardId` so two
 * boards don't share a cache entry.
 *
 * Reorder is a special-case mutation: the caller passes the desired
 * id-order; we update each column's `position` server-side, but the
 * cache is updated optimistically with the new order so the UI
 * doesn't flicker between the drop and the round-trip.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createColumn,
  deleteColumn,
  getColumn,
  listColumns,
  updateColumn,
  type CreateColumnArgs,
  type UpdateColumnArgs,
} from "../api";
import type { Column } from "./types";

/** Query-key factory. Scoped by board so caches don't cross-contaminate. */
export const columnsKeys = {
  all: ["columns"] as const,
  list: (boardId: string) => [...columnsKeys.all, "list", boardId] as const,
  detail: (id: string) => [...columnsKeys.all, "detail", id] as const,
};

/** `useColumns` — list every column on a board, ordered by position. */
export function useColumns(boardId: string): UseQueryResult<Column[], Error> {
  return useQuery({
    queryKey: columnsKeys.list(boardId),
    queryFn: () => listColumns(boardId),
    enabled: boardId.length > 0,
  });
}

/** `useColumn` — fetch a single column. Disabled when `id` is empty. */
export function useColumn(id: string): UseQueryResult<Column, Error> {
  return useQuery({
    queryKey: columnsKeys.detail(id),
    queryFn: () => getColumn(id),
    enabled: id.length > 0,
  });
}

/**
 * `useCreateColumnMutation` — create a column, then invalidate the
 * board-scoped list cache so any mounted `useColumns(boardId)`
 * re-fetches.
 */
export function useCreateColumnMutation(): UseMutationResult<
  Column,
  Error,
  CreateColumnArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createColumn,
    onSuccess: (column) => {
      void queryClient.invalidateQueries({
        queryKey: columnsKeys.list(column.boardId),
      });
    },
  });
}

export interface UpdateColumnVars extends UpdateColumnArgs {
  /**
   * Required so the mutation can invalidate the right `list(boardId)`
   * key. The IPC payload itself doesn't include `boardId`, but the
   * cache lookup does.
   */
  boardId: string;
}

/**
 * `useUpdateColumnMutation` — partial-update.
 *
 * Optimistic flow:
 *   1. snapshot the current list
 *   2. apply the patch in cache
 *   3. on error, restore the snapshot + propagate
 *   4. on settle, invalidate to reconcile
 */
export function useUpdateColumnMutation(): UseMutationResult<
  Column,
  Error,
  UpdateColumnVars,
  { previous: Column[] | undefined }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId: _boardId, ...args }) => updateColumn(args),
    onMutate: async (vars) => {
      const key = columnsKeys.list(vars.boardId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Column[]>(key);
      if (previous) {
        queryClient.setQueryData<Column[]>(
          key,
          previous.map((c) => {
            if (c.id !== vars.id) return c;
            return {
              ...c,
              ...(vars.name !== undefined ? { name: vars.name } : {}),
              ...(vars.position !== undefined
                ? { position: BigInt(Math.round(vars.position)) }
                : {}),
              ...(vars.roleId !== undefined ? { roleId: vars.roleId } : {}),
            };
          }),
        );
      }
      return { previous };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(columnsKeys.list(vars.boardId), ctx.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: columnsKeys.list(vars.boardId),
      });
    },
  });
}

export interface ReorderColumnsVars {
  boardId: string;
  /** Final id-order, left-to-right. */
  orderedIds: string[];
}

/**
 * `useReorderColumnsMutation` — write a new position to every column
 * in `orderedIds`, in parallel. Optimistic cache update reorders
 * locally before the round-trip so the user doesn't see a snap-back.
 *
 * Position scheme: rank `i` (0-indexed) gets position `i + 1`. We
 * could use a sparser scheme (gap-based) to avoid rewriting every
 * row on every reorder, but for a typical desktop board (~10 cols)
 * the parallel-update is well under 50ms and the simpler integer
 * positions stay readable when debugging.
 */
export function useReorderColumnsMutation(): UseMutationResult<
  void,
  Error,
  ReorderColumnsVars,
  { previous: Column[] | undefined }
> {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    ReorderColumnsVars,
    { previous: Column[] | undefined }
  >({
    mutationFn: async ({ orderedIds }) => {
      await Promise.all(
        orderedIds.map((id, idx) =>
          updateColumn({ id, position: idx + 1 }),
        ),
      );
    },
    onMutate: async (vars) => {
      const key = columnsKeys.list(vars.boardId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Column[]>(key);
      if (previous) {
        const indexById = new Map(vars.orderedIds.map((id, i) => [id, i]));
        const next = [...previous]
          .map((c) => ({
            ...c,
            position: BigInt((indexById.get(c.id) ?? -1) + 1),
          }))
          .sort((a, b) => Number(a.position - b.position));
        queryClient.setQueryData<Column[]>(key, next);
      }
      return { previous };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(columnsKeys.list(vars.boardId), ctx.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: columnsKeys.list(vars.boardId),
      });
    },
  });
}

/** `useDeleteColumnMutation` — delete + invalidate. */
export function useDeleteColumnMutation(): UseMutationResult<
  void,
  Error,
  { id: string; boardId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => deleteColumn(id),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: columnsKeys.list(vars.boardId),
      });
    },
  });
}
