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
  getTaskBundle,
  listTasksByBoard,
  listTasksByColumn,
  listAllTasks,
  listTaskLinks,
  linkTasks,
  unlinkTasks,
  updateTask,
  type LinkTasksArgs,
  addTaskPrompt,
  setTaskPrompts,
  listTaskPrompts,
  setTaskSkills,
  setTaskMcpTools,
  setTaskPromptOverride,
  clearTaskPromptOverride,
  setTaskSkillOverride,
  clearTaskSkillOverride,
  setTaskMcpToolOverride,
  clearTaskMcpToolOverride,
  type CreateTaskArgs,
  type UpdateTaskArgs,
  type AddTaskPromptArgs,
  type SetTaskPromptOverrideArgs,
  type ClearTaskPromptOverrideArgs,
  type SetTaskSkillOverrideArgs,
  type ClearTaskSkillOverrideArgs,
  type SetTaskMcpToolOverrideArgs,
  type ClearTaskMcpToolOverrideArgs,
} from "../api";
import type { Prompt } from "@bindings/Prompt";
import type { TaskBundle } from "@bindings/TaskBundle";
import type { TaskLink } from "@bindings/TaskLink";
import type { Task } from "./types";

export const tasksKeys = {
  all: ["tasks"] as const,
  byBoard: (boardId: string) =>
    [...tasksKeys.all, "byBoard", boardId] as const,
  byColumn: (columnId: string) =>
    [...tasksKeys.all, "byColumn", columnId] as const,
  detail: (id: string) => [...tasksKeys.all, "detail", id] as const,
  prompts: (taskId: string) =>
    [...tasksKeys.all, "prompts", taskId] as const,
  bundle: (taskId: string) =>
    [...tasksKeys.all, "bundle", taskId] as const,
  links: (taskId: string) =>
    [...tasksKeys.all, "links", taskId] as const,
};

/** `useTasksByBoard` — every task on a board. The kanban widget's hook. */
export function useTasksByBoard(boardId: string): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: tasksKeys.byBoard(boardId),
    queryFn: () => listTasksByBoard(boardId),
    enabled: boardId.length > 0,
  });
}

/** `useAllTasks` — every task across every board. Powers the relation picker. */
export function useAllTasks(): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: [...tasksKeys.all, "all-flat"] as const,
    queryFn: listAllTasks,
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

/**
 * `useTaskPrompts` — prompts attached to a task, ordered by position.
 * Disabled when `taskId` is empty to avoid spurious requests.
 */
export function useTaskPrompts(taskId: string): UseQueryResult<Prompt[], Error> {
  return useQuery({
    queryKey: tasksKeys.prompts(taskId),
    queryFn: () => listTaskPrompts(taskId),
    enabled: taskId.length > 0,
  });
}

/**
 * `useTaskBundle` — resolved agent bundle (prompts + skills + mcp_tools
 * with origin tags) for a task. Drives the Effective Context Panel.
 * ADR-0006 documents the resolver path; the query is keyed independently
 * of `useTask` so the heavy resolver call doesn't refire on minor task
 * row updates.
 */
export function useTaskBundle(
  taskId: string,
): UseQueryResult<TaskBundle, Error> {
  return useQuery({
    queryKey: tasksKeys.bundle(taskId),
    queryFn: () => getTaskBundle(taskId),
    enabled: taskId.length > 0,
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

// ──────────────────────────────────────────────────────────────────────
// Task links (catique-4).
// ──────────────────────────────────────────────────────────────────────

/**
 * `useTaskLinks` — every link the task participates in, either
 * direction. Keyed per-task; the EventsProvider invalidates both
 * endpoints on `task_link:created` / `task_link:deleted`.
 */
export function useTaskLinks(
  taskId: string,
): UseQueryResult<TaskLink[], Error> {
  return useQuery({
    queryKey: tasksKeys.links(taskId),
    queryFn: () => listTaskLinks(taskId),
    enabled: taskId.length > 0,
  });
}

/** Invalidate the link query for both endpoints of a link. */
function invalidateLinkEndpoints(
  queryClient: ReturnType<typeof useQueryClient>,
  args: LinkTasksArgs,
): void {
  void queryClient.invalidateQueries({
    queryKey: tasksKeys.links(args.srcTaskId),
  });
  void queryClient.invalidateQueries({
    queryKey: tasksKeys.links(args.dstTaskId),
  });
}

/** `useLinkTasksMutation` — create a link; invalidate both endpoints. */
export function useLinkTasksMutation(): UseMutationResult<
  TaskLink,
  Error,
  LinkTasksArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: linkTasks,
    onSuccess: (_data, vars) => invalidateLinkEndpoints(queryClient, vars),
  });
}

/** `useUnlinkTasksMutation` — remove a link; invalidate both endpoints. */
export function useUnlinkTasksMutation(): UseMutationResult<
  void,
  Error,
  LinkTasksArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unlinkTasks,
    onSuccess: (_data, vars) => invalidateLinkEndpoints(queryClient, vars),
  });
}

/**
 * `useAddTaskPromptMutation` — attach a prompt directly to a task and
 * invalidate the task-prompts list cache so the editor's chip row
 * reflects the new attachment without an extra round-trip.
 *
 * Without the `onSuccess` invalidation the backend persists the row
 * but the `useTaskPrompts(taskId)` cache stays stale until the user
 * closes and reopens the dialog (audit F-11).
 */
export function useAddTaskPromptMutation(): UseMutationResult<
  void,
  Error,
  AddTaskPromptArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addTaskPrompt,
    onSuccess: (_void, vars) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.prompts(vars.taskId),
      });
    },
  });
}

export interface SetTaskPromptsArgs {
  taskId: string;
  /** Prompts currently attached, in render order. */
  previous: ReadonlyArray<string>;
  /** Desired prompt list, in render order. */
  next: ReadonlyArray<string>;
}

/**
 * `useSetTaskPromptsMutation` — bulk set the directly-attached prompts
 * of a task. Used by the inline `<MultiSelect>` in TaskDialog
 * (audit-#8). Diffs internally via `setTaskPrompts`.
 */
export function useSetTaskPromptsMutation(): UseMutationResult<
  void,
  Error,
  SetTaskPromptsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, previous, next }) =>
      setTaskPrompts(taskId, previous, next),
    onSettled: (_void, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.prompts(vars.taskId),
      });
      // Bundle drives the XML preview (`TaskXmlPreview`); invalidate it too
      // so attach/detach reflects live — matching skills/mcpTools below.
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.bundle(vars.taskId),
      });
    },
  });
}

export interface SetTaskSkillsArgs {
  taskId: string;
  /** Skills currently directly attached, in render order. */
  previous: ReadonlyArray<string>;
  /** Desired skill list, in render order. */
  next: ReadonlyArray<string>;
}

/**
 * `useSetTaskSkillsMutation` — bulk set the directly-attached skills of a
 * task. Diffs internally via `setTaskSkills`. Invalidates the bundle cache
 * so `EffectiveContextPanel` re-renders with updated origin tags.
 */
export function useSetTaskSkillsMutation(): UseMutationResult<
  void,
  Error,
  SetTaskSkillsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, previous, next }) =>
      setTaskSkills(taskId, previous, next),
    onSettled: (_void, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.bundle(vars.taskId),
      });
    },
  });
}

export interface SetTaskMcpToolsArgs {
  taskId: string;
  /** MCP tools currently directly attached, in render order. */
  previous: ReadonlyArray<string>;
  /** Desired MCP tool list, in render order. */
  next: ReadonlyArray<string>;
}

/**
 * `useSetTaskMcpToolsMutation` — bulk set the directly-attached MCP tools of a
 * task. Diffs internally via `setTaskMcpTools`. Invalidates the bundle cache
 * so `EffectiveContextPanel` re-renders with updated origin tags.
 */
export function useSetTaskMcpToolsMutation(): UseMutationResult<
  void,
  Error,
  SetTaskMcpToolsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, previous, next }) =>
      setTaskMcpTools(taskId, previous, next),
    onSettled: (_void, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: tasksKeys.bundle(vars.taskId),
      });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Override-v2 mutations (refactor-v3 D-A).
//
// Each one invalidates `tasksKeys.bundle(taskId)` on settle so the
// EffectiveContextPanel re-resolves with the new origin/suppression
// state. Board-list `byBoard` is also invalidated because the
// denormalised effective_*_count columns shift with every override.
// ──────────────────────────────────────────────────────────────────────

function makeBundleInvalidator(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: tasksKeys.bundle(taskId),
  });
  void queryClient.invalidateQueries({
    queryKey: tasksKeys.detail(taskId),
  });
  // Effective-count columns ride along with bundle changes; rely on
  // refresh of the byBoard list so kanban cards re-render their badge.
  void queryClient.invalidateQueries({ queryKey: tasksKeys.all });
}

export function useSetTaskPromptOverrideMutation(): UseMutationResult<
  void,
  Error,
  SetTaskPromptOverrideArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setTaskPromptOverride,
    onSettled: (_void, _err, vars) => {
      makeBundleInvalidator(queryClient, vars.taskId);
    },
  });
}

export function useClearTaskPromptOverrideMutation(): UseMutationResult<
  void,
  Error,
  ClearTaskPromptOverrideArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearTaskPromptOverride,
    onSettled: (_void, _err, vars) => {
      makeBundleInvalidator(queryClient, vars.taskId);
    },
  });
}

export function useSetTaskSkillOverrideMutation(): UseMutationResult<
  void,
  Error,
  SetTaskSkillOverrideArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setTaskSkillOverride,
    onSettled: (_void, _err, vars) => {
      makeBundleInvalidator(queryClient, vars.taskId);
    },
  });
}

export function useClearTaskSkillOverrideMutation(): UseMutationResult<
  void,
  Error,
  ClearTaskSkillOverrideArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearTaskSkillOverride,
    onSettled: (_void, _err, vars) => {
      makeBundleInvalidator(queryClient, vars.taskId);
    },
  });
}

export function useSetTaskMcpToolOverrideMutation(): UseMutationResult<
  void,
  Error,
  SetTaskMcpToolOverrideArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setTaskMcpToolOverride,
    onSettled: (_void, _err, vars) => {
      makeBundleInvalidator(queryClient, vars.taskId);
    },
  });
}

export function useClearTaskMcpToolOverrideMutation(): UseMutationResult<
  void,
  Error,
  ClearTaskMcpToolOverrideArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearTaskMcpToolOverride,
    onSettled: (_void, _err, vars) => {
      makeBundleInvalidator(queryClient, vars.taskId);
    },
  });
}
