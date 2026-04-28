/**
 * `entities/prompt` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listPrompts,
  getPrompt,
  createPrompt,
  updatePrompt,
  deletePrompt,
  recomputePromptTokenCount,
} from "./api";
export type { CreatePromptArgs, UpdatePromptArgs } from "./api";

// Model
export {
  promptsKeys,
  usePrompts,
  usePrompt,
  useCreatePromptMutation,
  useUpdatePromptMutation,
  useDeletePromptMutation,
  useRecomputePromptTokenCountMutation,
} from "./model";
export type { Prompt } from "./model";

// UI
export { PromptCard } from "./ui";
export type { PromptCardProps } from "./ui";
