/**
 * `entities/mcp-tool-group` — public surface (FSD encapsulation).
 * The MCP mirror of `entities/prompt-group`.
 */

// API
export {
  listMcpToolGroups,
  getMcpToolGroup,
  createMcpToolGroup,
  updateMcpToolGroup,
  deleteMcpToolGroup,
  listMcpToolGroupMembers,
  addMcpToolGroupMember,
  removeMcpToolGroupMember,
  setMcpToolGroupMembers,
} from "./api";
export type {
  CreateMcpToolGroupArgs,
  UpdateMcpToolGroupArgs,
  AddMcpToolGroupMemberArgs,
  RemoveMcpToolGroupMemberArgs,
  SetMcpToolGroupMembersArgs,
} from "./api";

// Model
export {
  mcpToolGroupsKeys,
  useMcpToolGroups,
  useMcpToolGroup,
  useMcpToolGroupMembers,
  useMcpToolGroupMembersMap,
  useCreateMcpToolGroupMutation,
  useUpdateMcpToolGroupMutation,
  useDeleteMcpToolGroupMutation,
  useAddMcpToolGroupMemberMutation,
  useRemoveMcpToolGroupMemberMutation,
  useSetMcpToolGroupMembersMutation,
  useRoleMcpToolGroups,
  useBoardMcpToolGroups,
  useTaskMcpToolGroups,
  useSetRoleMcpToolGroupsMutation,
  useSetBoardMcpToolGroupsMutation,
  useSetTaskMcpToolGroupsMutation,
} from "./model";
export type { McpToolGroup } from "./model";

// Lib — combined mcp-tool + group select adapter
export {
  useGroupedMcpToolSelect,
  MCP_GROUP_VALUE_PREFIX,
  MCP_SERVER_VALUE_PREFIX,
} from "./lib/useGroupedMcpToolSelect";
export type {
  GroupedMcpToolSelectArgs,
  GroupedMcpToolSelectResult,
} from "./lib/useGroupedMcpToolSelect";
