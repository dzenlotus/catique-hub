/**
 * `entities/space` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listSpaces,
  getSpace,
  createSpace,
  updateSpace,
  deleteSpace,
  validatePrefix,
} from "./api";
export type { CreateSpaceArgs, UpdateSpaceArgs } from "./api";

// Model
export {
  spacesKeys,
  useSpaces,
  useSpace,
  useCreateSpaceMutation,
  useUpdateSpaceMutation,
  useDeleteSpaceMutation,
} from "./model";
export type { Space } from "./model";

// UI
export { SpaceCard } from "./ui";
export type { SpaceCardProps } from "./ui";
