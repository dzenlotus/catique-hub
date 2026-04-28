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
} from "./api";
export type { CreateTaskArgs, UpdateTaskArgs } from "./api";

// Model
export {
  tasksKeys,
  useTasksByBoard,
  useTasks,
  useTask,
  useCreateTaskMutation,
  useMoveTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
} from "./model";
export type { Task, MoveTaskVars, UpdateTaskVars } from "./model";

// UI
export { TaskCard } from "./ui";
export type { TaskCardProps } from "./ui";
