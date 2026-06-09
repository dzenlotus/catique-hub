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
  linkTasks,
  unlinkTasks,
  listTaskLinks,
  addTaskPrompt,
  removeTaskPrompt,
  setTaskPrompts,
  listTaskPrompts,
  getTaskBundle,
  addTaskSkill,
  removeTaskSkill,
  setTaskSkills,
  addTaskMcpTool,
  removeTaskMcpTool,
  setTaskMcpTools,
  setTaskPromptOverride,
  clearTaskPromptOverride,
  setTaskSkillOverride,
  clearTaskSkillOverride,
  setTaskMcpToolOverride,
  clearTaskMcpToolOverride,
} from "./api";
export type {
  CreateTaskArgs,
  UpdateTaskArgs,
  LinkTasksArgs,
  AddTaskPromptArgs,
  RemoveTaskPromptArgs,
  AddTaskSkillArgs,
  RemoveTaskSkillArgs,
  AddTaskMcpToolArgs,
  RemoveTaskMcpToolArgs,
  SetTaskPromptOverrideArgs,
  ClearTaskPromptOverrideArgs,
  SetTaskSkillOverrideArgs,
  ClearTaskSkillOverrideArgs,
  SetTaskMcpToolOverrideArgs,
  ClearTaskMcpToolOverrideArgs,
} from "./api";

// Model
export {
  tasksKeys,
  useTasksByBoard,
  useTasks,
  useAllTasks,
  useTask,
  useTaskPrompts,
  useTaskBundle,
  useTaskLinks,
  useLinkTasksMutation,
  useUnlinkTasksMutation,
  useTaskStatus,
  setTaskStatus,
  resetTaskStatuses,
  useTaskDraft,
  setTaskDraft,
  clearTaskDraft,
  resetTaskDrafts,
  useCreateTaskMutation,
  useMoveTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useAddTaskPromptMutation,
  useSetTaskPromptsMutation,
  useSetTaskSkillsMutation,
  useSetTaskMcpToolsMutation,
  useSetTaskPromptOverrideMutation,
  useClearTaskPromptOverrideMutation,
  useSetTaskSkillOverrideMutation,
  useClearTaskSkillOverrideMutation,
  useSetTaskMcpToolOverrideMutation,
  useClearTaskMcpToolOverrideMutation,
  effectiveCount,
} from "./model";
export type {
  Task,
  TaskDraft,
  MoveTaskVars,
  UpdateTaskVars,
  SetTaskPromptsArgs,
  SetTaskSkillsArgs,
  SetTaskMcpToolsArgs,
} from "./model";

// UI
export { TaskCard } from "./ui";
export type { TaskCardProps } from "./ui";
