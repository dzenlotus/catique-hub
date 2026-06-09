/**
 * `entities/task-template` — public surface (FSD encapsulation, catique-1).
 *
 * Internal modules under `./api` and `./model` MUST NOT be imported
 * directly from outside this slice.
 */

// API
export {
  listTaskTemplates,
  getTaskTemplate,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
} from "./api";
export type {
  CreateTaskTemplateArgs,
  UpdateTaskTemplateArgs,
} from "./api";

// Model
export {
  taskTemplatesKeys,
  useTaskTemplates,
  useTaskTemplate,
  useCreateTaskTemplateMutation,
  useUpdateTaskTemplateMutation,
  useDeleteTaskTemplateMutation,
} from "./model";
export type { TaskTemplate, TaskTemplateKind } from "./model";
