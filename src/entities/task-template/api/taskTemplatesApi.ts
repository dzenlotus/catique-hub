/**
 * Task templates IPC client (catique-1).
 *
 * Named markdown skeletons picked when creating a task. camelCase JS
 * args; the shared `invokeWithAppError` wrapper rethrows the Rust
 * `AppError` as a typed `AppErrorInstance`.
 */

import { invokeWithAppError } from "@shared/api";
import type { TaskTemplate } from "@bindings/TaskTemplate";
import type { TaskTemplateKind } from "@bindings/TaskTemplateKind";

/** `list_task_templates` — every template (position-ordered). */
export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  return invokeWithAppError<TaskTemplate[]>("list_task_templates");
}

/** `get_task_template` — single template by id. */
export async function getTaskTemplate(id: string): Promise<TaskTemplate> {
  return invokeWithAppError<TaskTemplate>("get_task_template", { id });
}

export interface CreateTaskTemplateArgs {
  name: string;
  kind: TaskTemplateKind;
  description?: string;
  body?: string;
  icon?: string | null;
  color?: string | null;
}

/** `create_task_template` — add a template. */
export async function createTaskTemplate(
  args: CreateTaskTemplateArgs,
): Promise<TaskTemplate> {
  return invokeWithAppError<TaskTemplate>("create_task_template", {
    name: args.name,
    kind: args.kind,
    description: args.description ?? "",
    body: args.body ?? "",
    icon: args.icon ?? null,
    color: args.color ?? null,
  });
}

export interface UpdateTaskTemplateArgs {
  id: string;
  name?: string;
  kind?: TaskTemplateKind;
  description?: string;
  body?: string;
  icon?: string | null;
  color?: string | null;
  position?: number;
}

/** `update_task_template` — partial update. */
export async function updateTaskTemplate(
  args: UpdateTaskTemplateArgs,
): Promise<TaskTemplate> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.kind !== undefined) payload.kind = args.kind;
  if (args.description !== undefined) payload.description = args.description;
  if (args.body !== undefined) payload.body = args.body;
  if (args.icon !== undefined) payload.icon = args.icon;
  if (args.color !== undefined) payload.color = args.color;
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<TaskTemplate>("update_task_template", payload);
}

/** `delete_task_template` — remove by id. */
export async function deleteTaskTemplate(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_task_template", { id });
}
