/**
 * `entities/prompt-group` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listPromptGroups,
  getPromptGroup,
  createPromptGroup,
  updatePromptGroup,
  deletePromptGroup,
  listPromptGroupMembers,
  addPromptGroupMember,
  removePromptGroupMember,
  setPromptGroupMembers,
} from "./api";
export type {
  CreatePromptGroupArgs,
  UpdatePromptGroupArgs,
  AddPromptGroupMemberArgs,
  RemovePromptGroupMemberArgs,
  SetPromptGroupMembersArgs,
} from "./api";

// Model
export {
  promptGroupsKeys,
  usePromptGroups,
  usePromptGroup,
  usePromptGroupMembers,
  usePromptGroupMembersMap,
  useCreatePromptGroupMutation,
  useUpdatePromptGroupMutation,
  useDeletePromptGroupMutation,
  useAddPromptGroupMemberMutation,
  useRemovePromptGroupMemberMutation,
  useSetPromptGroupMembersMutation,
  useRolePromptGroups,
  useBoardPromptGroups,
  useTaskPromptGroups,
  useSetRolePromptGroupsMutation,
  useSetBoardPromptGroupsMutation,
  useSetTaskPromptGroupsMutation,
} from "./model";
export type { PromptGroup } from "./model";

// UI
export { PromptGroupCard } from "./ui";
export type { PromptGroupCardProps } from "./ui";

// Lib — combined prompt+group select adapter
export {
  useGroupedPromptSelect,
  GROUP_VALUE_PREFIX,
} from "./lib/useGroupedPromptSelect";
export type {
  GroupedPromptSelectArgs,
  GroupedPromptSelectResult,
} from "./lib/useGroupedPromptSelect";
