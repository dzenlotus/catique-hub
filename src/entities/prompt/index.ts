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
  listPromptTagsMap,
  recomputePromptTokenCount,
  listPromptVersions,
  getPromptVersion,
  revertPromptToVersion,
} from "./api";
export type { CreatePromptArgs, UpdatePromptArgs } from "./api";

// Model
export {
  promptsKeys,
  usePrompts,
  usePrompt,
  usePromptTagsMap,
  useCreatePromptMutation,
  useUpdatePromptMutation,
  useDeletePromptMutation,
  useRecomputePromptTokenCountMutation,
  usePromptVersions,
  usePromptVersion,
  useRevertPromptToVersionMutation,
  PROMPT_TEMPLATE_STORAGE_KEY,
  promptTemplateCodec,
} from "./model";
export type {
  Prompt,
  PromptTemplate,
  RevertPromptToVersionArgs,
} from "./model";

// UI
export { PromptCard } from "./ui";
export type { PromptCardProps } from "./ui";
