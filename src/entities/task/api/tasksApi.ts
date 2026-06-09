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

import { invokeWithAppError } from "@shared/api";
import type { Prompt } from "@bindings/Prompt";
import type { Task } from "@bindings/Task";
import type { TaskBundle } from "@bindings/TaskBundle";
import type { TaskKind } from "@bindings/TaskKind";
import type { TaskLink } from "@bindings/TaskLink";
import type { TaskLinkKind } from "@bindings/TaskLinkKind";

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

/** `list_tasks` — every task across every board (used by the relation picker). */
export async function listAllTasks(): Promise<Task[]> {
  return invokeWithAppError<Task[]>("list_tasks");
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
  /** Task classification. Skip = `undefined` (backend defaults `blank`). */
  kind?: TaskKind;
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
  if (args.kind !== undefined) payload.kind = args.kind;
  return invokeWithAppError<Task>("create_task", payload);
}

export interface UpdateTaskArgs {
  id: string;
  title?: string;
  /** Skip = `undefined`, set = string, clear = `null`. */
  description?: string | null;
  /** Change classification. */
  kind?: TaskKind;
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
  if (args.kind !== undefined) payload.kind = args.kind;
  if (args.columnId !== undefined) payload.columnId = args.columnId;
  if (args.position !== undefined) payload.position = args.position;
  if (args.roleId !== undefined) payload.roleId = args.roleId;
  return invokeWithAppError<Task>("update_task", payload);
}

/** `delete_task` — remove. */
export async function deleteTask(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_task", { id });
}

// ──────────────────────────────────────────────────────────────────────
// Task links (catique-4) — minimal task↔task relationship surface.
// ──────────────────────────────────────────────────────────────────────

export interface LinkTasksArgs {
  srcTaskId: string;
  dstTaskId: string;
  kind: TaskLinkKind;
}

/** `link_tasks` — create one directional link. Idempotent on the Rust side. */
export async function linkTasks(args: LinkTasksArgs): Promise<TaskLink> {
  return invokeWithAppError<TaskLink>("link_tasks", {
    srcTaskId: args.srcTaskId,
    dstTaskId: args.dstTaskId,
    kind: args.kind,
  });
}

/** `unlink_tasks` — remove one link. Idempotent. */
export async function unlinkTasks(args: LinkTasksArgs): Promise<void> {
  return invokeWithAppError<void>("unlink_tasks", {
    srcTaskId: args.srcTaskId,
    dstTaskId: args.dstTaskId,
    kind: args.kind,
  });
}

/** `list_task_links` — every link a task participates in, either direction. */
export async function listTaskLinks(taskId: string): Promise<TaskLink[]> {
  return invokeWithAppError<TaskLink[]>("list_task_links", { taskId });
}

/** `list_task_prompts` — all prompts attached to a task, ordered by position. */
export async function listTaskPrompts(taskId: string): Promise<Prompt[]> {
  return invokeWithAppError<Prompt[]>("list_task_prompts", { taskId });
}

/**
 * `get_task_bundle` — resolved agent bundle for a task: prompts /
 * skills / mcp-tools each tagged with their inheritance origin. The
 * EffectiveContextPanel reads this; ADR-0006 documents the resolver.
 */
export async function getTaskBundle(taskId: string): Promise<TaskBundle> {
  return invokeWithAppError<TaskBundle>("get_task_bundle", { taskId });
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

export interface RemoveTaskPromptArgs {
  taskId: string;
  promptId: string;
}

/** `remove_task_prompt` — detach a directly-attached prompt from a task. */
export async function removeTaskPrompt(
  args: RemoveTaskPromptArgs,
): Promise<void> {
  return invokeWithAppError<void>("remove_task_prompt", {
    taskId: args.taskId,
    promptId: args.promptId,
  });
}

export interface AddTaskSkillArgs {
  taskId: string;
  skillId: string;
  position: number;
}

/** `add_task_skill` — attach a skill directly to a task at the given position. */
export async function addTaskSkill(args: AddTaskSkillArgs): Promise<void> {
  return invokeWithAppError<void>("add_task_skill", {
    taskId: args.taskId,
    skillId: args.skillId,
    position: args.position,
  });
}

export interface RemoveTaskSkillArgs {
  taskId: string;
  skillId: string;
}

/** `remove_task_skill` — detach a directly-attached skill from a task. */
export async function removeTaskSkill(
  args: RemoveTaskSkillArgs,
): Promise<void> {
  return invokeWithAppError<void>("remove_task_skill", {
    taskId: args.taskId,
    skillId: args.skillId,
  });
}

/**
 * `setTaskSkills` — bulk set the directly-attached skill list of a task
 * by computing the diff against `previous` and dispatching
 * `add_task_skill` / `remove_task_skill`.
 */
export async function setTaskSkills(
  taskId: string,
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): Promise<void> {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const toRemove = previous.filter((id) => !nextSet.has(id));
  const toAdd = next.filter((id) => !previousSet.has(id));
  for (const skillId of toRemove) {
    await removeTaskSkill({ taskId, skillId });
  }
  let position = previous.length - toRemove.length;
  for (const skillId of toAdd) {
    await addTaskSkill({ taskId, skillId, position });
    position += 1;
  }
}

export interface AddTaskMcpToolArgs {
  taskId: string;
  mcpToolId: string;
  position: number;
}

/** `add_task_mcp_tool` — attach an MCP tool directly to a task at the given position. */
export async function addTaskMcpTool(args: AddTaskMcpToolArgs): Promise<void> {
  return invokeWithAppError<void>("add_task_mcp_tool", {
    taskId: args.taskId,
    mcpToolId: args.mcpToolId,
    position: args.position,
  });
}

export interface RemoveTaskMcpToolArgs {
  taskId: string;
  mcpToolId: string;
}

/** `remove_task_mcp_tool` — detach a directly-attached MCP tool from a task. */
export async function removeTaskMcpTool(
  args: RemoveTaskMcpToolArgs,
): Promise<void> {
  return invokeWithAppError<void>("remove_task_mcp_tool", {
    taskId: args.taskId,
    mcpToolId: args.mcpToolId,
  });
}

/**
 * `setTaskMcpTools` — bulk set the directly-attached MCP tool list of a task
 * by computing the diff against `previous` and dispatching
 * `add_task_mcp_tool` / `remove_task_mcp_tool`.
 */
export async function setTaskMcpTools(
  taskId: string,
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): Promise<void> {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const toRemove = previous.filter((id) => !nextSet.has(id));
  const toAdd = next.filter((id) => !previousSet.has(id));
  for (const mcpToolId of toRemove) {
    await removeTaskMcpTool({ taskId, mcpToolId });
  }
  let position = previous.length - toRemove.length;
  for (const mcpToolId of toAdd) {
    await addTaskMcpTool({ taskId, mcpToolId, position });
    position += 1;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Override-v2 surface (refactor-v3 D-A).
//
// One pair of IPC commands per inheritable entity kind. The replacement
// argument is `null` → suppress the inherited row entirely; a string id
// → replace the inherited row with another instance of the same kind.
// Passing `undefined` is illegal — the wrapper normalises to `null`.
// ──────────────────────────────────────────────────────────────────────

export interface SetTaskPromptOverrideArgs {
  taskId: string;
  sourcePromptId: string;
  /** `null` = suppress, string id = replace with that prompt. */
  replacementPromptId: string | null;
}

export async function setTaskPromptOverride(
  args: SetTaskPromptOverrideArgs,
): Promise<void> {
  return invokeWithAppError<void>("set_task_prompt_override_v2", {
    taskId: args.taskId,
    sourcePromptId: args.sourcePromptId,
    replacementPromptId: args.replacementPromptId,
  });
}

export interface ClearTaskPromptOverrideArgs {
  taskId: string;
  sourcePromptId: string;
}

export async function clearTaskPromptOverride(
  args: ClearTaskPromptOverrideArgs,
): Promise<void> {
  return invokeWithAppError<void>("clear_task_prompt_override_v2", {
    taskId: args.taskId,
    sourcePromptId: args.sourcePromptId,
  });
}

export interface SetTaskSkillOverrideArgs {
  taskId: string;
  sourceSkillId: string;
  replacementSkillId: string | null;
}

export async function setTaskSkillOverride(
  args: SetTaskSkillOverrideArgs,
): Promise<void> {
  return invokeWithAppError<void>("set_task_skill_override_v2", {
    taskId: args.taskId,
    sourceSkillId: args.sourceSkillId,
    replacementSkillId: args.replacementSkillId,
  });
}

export interface ClearTaskSkillOverrideArgs {
  taskId: string;
  sourceSkillId: string;
}

export async function clearTaskSkillOverride(
  args: ClearTaskSkillOverrideArgs,
): Promise<void> {
  return invokeWithAppError<void>("clear_task_skill_override_v2", {
    taskId: args.taskId,
    sourceSkillId: args.sourceSkillId,
  });
}

export interface SetTaskMcpToolOverrideArgs {
  taskId: string;
  sourceToolId: string;
  replacementToolId: string | null;
}

export async function setTaskMcpToolOverride(
  args: SetTaskMcpToolOverrideArgs,
): Promise<void> {
  return invokeWithAppError<void>("set_task_mcp_tool_override_v2", {
    taskId: args.taskId,
    sourceToolId: args.sourceToolId,
    replacementToolId: args.replacementToolId,
  });
}

export interface ClearTaskMcpToolOverrideArgs {
  taskId: string;
  sourceToolId: string;
}

export async function clearTaskMcpToolOverride(
  args: ClearTaskMcpToolOverrideArgs,
): Promise<void> {
  return invokeWithAppError<void>("clear_task_mcp_tool_override_v2", {
    taskId: args.taskId,
    sourceToolId: args.sourceToolId,
  });
}

/**
 * `setTaskPrompts` — bulk set the directly-attached prompt list of a
 * task by computing the diff against `previous` and dispatching the
 * existing `add_task_prompt` / `remove_task_prompt` IPCs (audit-#8).
 */
export async function setTaskPrompts(
  taskId: string,
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): Promise<void> {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const toRemove = previous.filter((id) => !nextSet.has(id));
  const toAdd = next.filter((id) => !previousSet.has(id));
  for (const promptId of toRemove) {
    await removeTaskPrompt({ taskId, promptId });
  }
  let position = previous.length - toRemove.length;
  for (const promptId of toAdd) {
    await addTaskPrompt({ taskId, promptId, position });
    position += 1;
  }
}
