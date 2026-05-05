/**
 * `entities/task` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice.
 */

// API
export {
  listTasksByBoard,
  listTasksByColumn,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  addTaskPrompt,
  removeTaskPrompt,
  setTaskPrompts,
  listTaskPrompts,
} from "./api";
export type {
  CreateTaskArgs,
  UpdateTaskArgs,
  AddTaskPromptArgs,
  RemoveTaskPromptArgs,
} from "./api";

// Model
export {
  tasksKeys,
  useTasksByBoard,
  useTasks,
  useTask,
  useTaskPrompts,
  useCreateTaskMutation,
  useMoveTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useAddTaskPromptMutation,
  useSetTaskPromptsMutation,
} from "./model";
export type {
  Task,
  MoveTaskVars,
  UpdateTaskVars,
  SetTaskPromptsArgs,
} from "./model";

// UI
export { TaskCard } from "./ui";
export type { TaskCardProps } from "./ui";
