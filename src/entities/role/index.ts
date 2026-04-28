/**
 * `entities/role` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  addRolePrompt,
} from "./api";
export type {
  CreateRoleArgs,
  UpdateRoleArgs,
  AddRolePromptArgs,
} from "./api";

// Model
export {
  rolesKeys,
  useRoles,
  useRole,
  useCreateRoleMutation,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
  useAddRolePromptMutation,
} from "./model";
export type { Role } from "./model";

// UI
export { RoleCard } from "./ui";
export type { RoleCardProps } from "./ui";
