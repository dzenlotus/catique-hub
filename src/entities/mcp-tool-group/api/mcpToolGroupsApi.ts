/**
 * McpToolGroups IPC client — the MCP mirror of `entities/prompt-group`.
 *
 * Wraps Tauri `invoke` for the `McpToolGroup` aggregate: CRUD, member
 * management, and group-as-live-unit attachment at role / board / task
 * scope. camelCase keys on the JS side per the Tauri v2 convention.
 */

import { invokeWithAppError } from "@shared/api";
import type { McpToolGroup } from "@bindings/McpToolGroup";

/** `list_mcp_tool_groups` — return every MCP tool group. */
export async function listMcpToolGroups(): Promise<McpToolGroup[]> {
  return invokeWithAppError<McpToolGroup[]>("list_mcp_tool_groups");
}

/** `get_mcp_tool_group` — fetch a single group by id. */
export async function getMcpToolGroup(id: string): Promise<McpToolGroup> {
  return invokeWithAppError<McpToolGroup>("get_mcp_tool_group", { id });
}

export interface CreateMcpToolGroupArgs {
  name: string;
  color?: string;
  icon?: string;
  position?: bigint;
}

/** `create_mcp_tool_group` — create a new group. */
export async function createMcpToolGroup(
  args: CreateMcpToolGroupArgs,
): Promise<McpToolGroup> {
  const payload: Record<string, unknown> = { name: args.name };
  if (args.color !== undefined) payload.color = args.color;
  if (args.icon !== undefined) payload.icon = args.icon;
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<McpToolGroup>("create_mcp_tool_group", payload);
}

export interface UpdateMcpToolGroupArgs {
  id: string;
  name?: string;
  /** Skip = `undefined`, set = string, clear = `null`. */
  color?: string | null;
  icon?: string | null;
  position?: bigint;
}

/** `update_mcp_tool_group` — partial update. */
export async function updateMcpToolGroup(
  args: UpdateMcpToolGroupArgs,
): Promise<McpToolGroup> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.color !== undefined) payload.color = args.color;
  if (args.icon !== undefined) payload.icon = args.icon;
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<McpToolGroup>("update_mcp_tool_group", payload);
}

/** `delete_mcp_tool_group` — remove a group. */
export async function deleteMcpToolGroup(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_mcp_tool_group", { id });
}

/** `list_mcp_tool_group_members` — ordered mcp-tool ids for a group. */
export async function listMcpToolGroupMembers(
  groupId: string,
): Promise<string[]> {
  return invokeWithAppError<string[]>("list_mcp_tool_group_members", {
    groupId,
  });
}

export interface AddMcpToolGroupMemberArgs {
  groupId: string;
  mcpToolId: string;
  position: bigint;
}

/** `add_mcp_tool_group_member` — add a tool to the group at a position. */
export async function addMcpToolGroupMember(
  args: AddMcpToolGroupMemberArgs,
): Promise<void> {
  return invokeWithAppError<void>("add_mcp_tool_group_member", {
    groupId: args.groupId,
    mcpToolId: args.mcpToolId,
    position: Number(args.position),
  });
}

export interface RemoveMcpToolGroupMemberArgs {
  groupId: string;
  mcpToolId: string;
}

/** `remove_mcp_tool_group_member` — remove a tool from the group. */
export async function removeMcpToolGroupMember(
  args: RemoveMcpToolGroupMemberArgs,
): Promise<void> {
  return invokeWithAppError<void>("remove_mcp_tool_group_member", {
    groupId: args.groupId,
    mcpToolId: args.mcpToolId,
  });
}

export interface SetMcpToolGroupMembersArgs {
  groupId: string;
  orderedToolIds: string[];
}

/** `set_mcp_tool_group_members` — replace the entire ordered member list. */
export async function setMcpToolGroupMembers(
  args: SetMcpToolGroupMembersArgs,
): Promise<void> {
  return invokeWithAppError<void>("set_mcp_tool_group_members", {
    groupId: args.groupId,
    orderedToolIds: args.orderedToolIds,
  });
}

// ── group attachment ─────────────────────────────────────────────────

/** `list_role_mcp_tool_groups` — mcp-tool-group ids attached to a role. */
export async function listRoleMcpToolGroups(roleId: string): Promise<string[]> {
  return invokeWithAppError<string[]>("list_role_mcp_tool_groups", { roleId });
}

/** `set_role_mcp_tool_groups` — replace a role's attached mcp-tool groups. */
export async function setRoleMcpToolGroups(
  roleId: string,
  groupIds: string[],
): Promise<void> {
  return invokeWithAppError<void>("set_role_mcp_tool_groups", {
    roleId,
    groupIds,
  });
}

/** `list_board_mcp_tool_groups` — mcp-tool-group ids attached to a board. */
export async function listBoardMcpToolGroups(
  boardId: string,
): Promise<string[]> {
  return invokeWithAppError<string[]>("list_board_mcp_tool_groups", {
    boardId,
  });
}

/** `set_board_mcp_tool_groups` — replace a board's attached mcp-tool groups. */
export async function setBoardMcpToolGroups(
  boardId: string,
  groupIds: string[],
): Promise<void> {
  return invokeWithAppError<void>("set_board_mcp_tool_groups", {
    boardId,
    groupIds,
  });
}

/** `list_task_mcp_tool_groups` — mcp-tool-group ids attached to a task. */
export async function listTaskMcpToolGroups(taskId: string): Promise<string[]> {
  return invokeWithAppError<string[]>("list_task_mcp_tool_groups", { taskId });
}

/** `set_task_mcp_tool_groups` — replace a task's attached mcp-tool groups. */
export async function setTaskMcpToolGroups(
  taskId: string,
  groupIds: string[],
): Promise<void> {
  return invokeWithAppError<void>("set_task_mcp_tool_groups", {
    taskId,
    groupIds,
  });
}
