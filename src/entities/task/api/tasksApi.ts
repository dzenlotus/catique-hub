/**
 * Tasks IPC client.
 *
 * Same conventions as `entities/board/api/boardsApi.ts` and
 * `entities/column/api/columnsApi.ts` — camelCase JS args, AppError
 * remapping to `AppErrorInstance`.
 *
 * `list_tasks` on the Rust side returns every task across every board
 * (no `column_id` filter argument). We filter by `columnId` on the JS
 * side. Same trade-off as `list_columns` — fine for desktop scale.
 *
 * TODO(coordinate-with-olga): server-side `list_tasks(boardId)` would
 * let `useTasks(boardId)` work without enumerating columns — useful for
 * the kanban-board widget where we want every task on the board in one
 * request.
 */

import { invoke } from "@shared/api";
import { AppErrorInstance } from "@entities/board";
import type { AppError } from "@bindings/AppError";
import type { Task } from "@bindings/Task";

function isAppErrorShape(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string") return false;
  return (
    kind === "validation" ||
    kind === "transactionRolledBack" ||
    kind === "dbBusy" ||
    kind === "lockTimeout" ||
    kind === "internalPanic" ||
    kind === "notFound" ||
    kind === "conflict" ||
    kind === "secretAccessDenied"
  );
}

async function invokeWithAppError<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (isAppErrorShape(raw)) {
      throw new AppErrorInstance(raw);
    }
    throw raw;
  }
}

/**
 * `list_tasks` for an entire board. Filters client-side by `boardId`.
 */
export async function listTasksByBoard(boardId: string): Promise<Task[]> {
  const all = await invokeWithAppError<Task[]>("list_tasks");
  return all
    .filter((t) => t.boardId === boardId)
    .sort((a, b) => a.position - b.position);
}

/**
 * `list_tasks` for a single column. Convenience wrapper used by widgets
 * that mount one column-list at a time (rare — the kanban widget pulls
 * everything for the board and groups locally).
 */
export async function listTasksByColumn(columnId: string): Promise<Task[]> {
  const all = await invokeWithAppError<Task[]>("list_tasks");
  return all
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => a.position - b.position);
}

/** `get_task` — single task by id. */
export async function getTask(id: string): Promise<Task> {
  return invokeWithAppError<Task>("get_task", { id });
}

export interface CreateTaskArgs {
  boardId: string;
  columnId: string;
  title: string;
  /** Optional initial description (passes through to Rust). */
  description?: string | null;
  /**
   * Position rank in the destination column. Caller computes via
   * `widgets/kanban-board/dragLogic.computeNewPosition` — usually
   * `lastTask.position + 1` for an append.
   */
  position: number;
  /** Skip = `undefined`, set = string id, clear = `null`. */
  roleId?: string | null;
}

/** `create_task` — append a task to a column. */
export async function createTask(args: CreateTaskArgs): Promise<Task> {
  const payload: Record<string, unknown> = {
    boardId: args.boardId,
    columnId: args.columnId,
    title: args.title,
    position: args.position,
  };
  if (args.description !== undefined) payload.description = args.description;
  if (args.roleId !== undefined) payload.roleId = args.roleId;
  return invokeWithAppError<Task>("create_task", payload);
}

export interface UpdateTaskArgs {
  id: string;
  title?: string;
  /** Skip = `undefined`, set = string, clear = `null`. */
  description?: string | null;
  /** Move to another column. */
  columnId?: string;
  /** New position rank. */
  position?: number;
  /** Skip = `undefined`, set = string, clear = `null`. */
  roleId?: string | null;
}

/** `update_task` — partial update. Used for moves (column + position). */
export async function updateTask(args: UpdateTaskArgs): Promise<Task> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.title !== undefined) payload.title = args.title;
  if (args.description !== undefined) payload.description = args.description;
  if (args.columnId !== undefined) payload.columnId = args.columnId;
  if (args.position !== undefined) payload.position = args.position;
  if (args.roleId !== undefined) payload.roleId = args.roleId;
  return invokeWithAppError<Task>("update_task", payload);
}

/** `delete_task` — remove. */
export async function deleteTask(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_task", { id });
}

export interface AddTaskPromptArgs {
  taskId: string;
  promptId: string;
  position: number;
}

/**
 * `add_task_prompt` — attach a prompt directly to a task at the given
 * position. Throws AppError `transactionRolledBack` on FK violation.
 */
export async function addTaskPrompt(args: AddTaskPromptArgs): Promise<void> {
  return invokeWithAppError<void>("add_task_prompt", {
    taskId: args.taskId,
    promptId: args.promptId,
    position: args.position,
  });
}
