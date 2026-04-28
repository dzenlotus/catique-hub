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
} from "./api";
export type { CreateTagArgs, UpdateTagArgs } from "./api";

// Model
export {
  tagsKeys,
  useTags,
  useTag,
  useCreateTagMutation,
  useUpdateTagMutation,
  useDeleteTagMutation,
} from "./model";
export type { Tag } from "./model";

// UI
export { TagChip } from "./ui";
export type { TagChipProps } from "./ui";
