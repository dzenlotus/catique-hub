/**
 * `entities/tag` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listTags,
  getTag,
  createTag,
  updateTag,
  deleteTag,
  addPromptTag,
  removePromptTag,
} from "./api";
export type {
  CreateTagArgs,
  UpdateTagArgs,
  PromptTagArgs,
} from "./api";

// Model
export {
  tagsKeys,
  useTags,
  useTag,
  useCreateTagMutation,
  useUpdateTagMutation,
  useDeleteTagMutation,
  useAddPromptTagMutation,
  useRemovePromptTagMutation,
} from "./model";
export type { Tag } from "./model";

// UI
export { TagChip } from "./ui";
export type { TagChipProps } from "./ui";
