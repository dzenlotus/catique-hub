/**
 * Tasks query-cache layer.
 *
 * Keying convention:
 *   - `tasksKeys.byBoard(boardId)` — every task on a board (kanban widget)
 *   - `tasksKeys.byColumn(columnId)` — every task in a single column
 *     (rare; reserved for column-only widgets we don't ship yet)
 *   - `tasksKeys.detail(id)` — single task
 *
 * The kanban widget mutates `byBoard(boardId)` for moves so a single
 * cache entry holds the full board snapshot during drag operations.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createTask,
  deleteTask,
  getTask,
  listTasksByBoard,
  listTasksByColumn,
  updateTask,
  type CreateTaskArgs,
  type UpdateTaskArgs,
} from "../api";
import type { Task } from "./types";

export const tasksKeys = {
  all: ["tasks"] as const,
  byBoard: (boardId: string) =>
    [...tasksKeys.all, "byBoard", boardId] as const,
  byColumn: (columnId: string) =>
    [...tasksKeys.all, "byColumn", columnId] as const,
  detail: (id: string) => [...tasksKeys.all, "detail", id] as const,
};

/** `useTasksByBoard` — every task on a board. The kanban widget's hook. */
export function useTasksByBoard(boardId: string): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: tasksKeys.byBoard(boardId),
    queryFn: () => listTasksByBoard(boardId),
    enabled: boardId.length > 0,
  });
}

/** `useTasks` — alias of `useTasksByColumn` for ergonomic call-sites. */
export function useTasks(columnId: string): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: tasksKeys.byColumn(columnId),
    queryFn: () => listTasksByColumn(columnId),
    enabled: columnId.length > 0,
  });
}

/** `useTask` — single task. */
export function useTask(id: string): UseQueryResult<Task, Error> {
  return useQuery({
    queryKey: tasksKeys.detail(id),
    queryFn: () => getTask(id),
    enabled: id.length > 0,
  });
}

/** `useCreateTaskMutation` — create + invalidate the board cache. */
export function useCreateTaskMutation(): UseMutationResult<
  Task,
  Error,
  CreateTaskArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: (task) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.byBoard(task.boardId),
      });
    },
  });
}

export interface MoveTaskVars {
  /** Required for cache scoping (the IPC payload doesn't carry boardId). */
  boardId: string;
  /** Task being moved. */
  id: string;
  /** Destination column. */
  columnId: string;
  /** Destination position rank — `dragLogic.computeNewPosition`. */
  position: number;
}

/**
 * `useMoveTaskMutation` — optimistic move.
 *
 * Flow:
 *   1. snapshot the current `byBoard` cache
 *   2. patch the moved task (columnId + position)
 *   3. on error, restore + propagate
 *   4. on settle, invalidate to reconcile
 */
export function useMoveTaskMutation(): UseMutationResult<
  Task,
  Error,
  MoveTaskVars,
  { previous: Task[] | undefined }
> {
  const queryClient = useQueryClient();
  return useMutation<
    Task,
    Error,
    MoveTaskVars,
    { previous: Task[] | undefined }
  >({
    mutationFn: ({ id, columnId, position }) =>
      updateTask({ id, columnId, position }),
    onMutate: async (vars) => {
      const key = tasksKeys.byBoard(vars.boardId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      if (previous) {
        queryClient.setQueryData<Task[]>(
          key,
          previous.map((t) =>
            t.id === vars.id
              ? { ...t, columnId: vars.columnId, position: vars.position }
              : t,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(tasksKeys.byBoard(vars.boardId), ctx.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.byBoard(vars.boardId),
      });
    },
  });
}

export interface UpdateTaskVars extends UpdateTaskArgs {
  /** Required for cache invalidation; not sent over IPC. */
  boardId: string;
}

/** `useUpdateTaskMutation` — generic partial update + invalidate. */
export function useUpdateTaskMutation(): UseMutationResult<
  Task,
  Error,
  UpdateTaskVars
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId: _boardId, ...args }) => updateTask(args),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.byBoard(vars.boardId),
      });
    },
  });
}

/** `useDeleteTaskMutation` — delete + invalidate the board cache. */
export function useDeleteTaskMutation(): UseMutationResult<
  void,
  Error,
  { id: string; boardId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => deleteTask(id),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.byBoard(vars.boardId),
      });
    },
  });
}
