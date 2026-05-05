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
  removeRolePrompt,
  listRolePrompts,
  setRolePrompts,
  addRoleSkill,
  removeRoleSkill,
  listRoleSkills,
  setRoleSkills,
  addRoleMcpTool,
  removeRoleMcpTool,
  listRoleMcpTools,
  setRoleMcpTools,
} from "./api";
export type {
  CreateRoleArgs,
  UpdateRoleArgs,
  AddRolePromptArgs,
  RemoveRolePromptArgs,
  AddRoleSkillArgs,
  RemoveRoleSkillArgs,
  AddRoleMcpToolArgs,
  RemoveRoleMcpToolArgs,
} from "./api";

// Model
export {
  rolesKeys,
  useRoles,
  useRole,
  useCreateRoleMutation,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
  useRolePrompts,
  useAddRolePromptMutation,
  useRemoveRolePromptMutation,
  useSetRolePromptsMutation,
  useRoleSkills,
  useAddRoleSkillMutation,
  useRemoveRoleSkillMutation,
  useSetRoleSkillsMutation,
  useRoleMcpTools,
  useAddRoleMcpToolMutation,
  useRemoveRoleMcpToolMutation,
  useSetRoleMcpToolsMutation,
} from "./model";
export type {
  Role,
  UseRolesOptions,
  SetRolePromptsArgs,
  SetRoleSkillsArgs,
  SetRoleMcpToolsArgs,
} from "./model";

// UI
export { RoleCard } from "./ui";
export type { RoleCardProps } from "./ui";
