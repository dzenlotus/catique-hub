/**
 * MCP tool groups command dispatcher (CRUD + members + attach joins).
 * The MCP mirror of `promptGroups.ts`.
 */

import type { McpToolGroup } from "@bindings/McpToolGroup";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateArgs {
  name: string;
  color?: string | null;
  icon?: string | null;
  position?: number;
}

interface UpdateArgs {
  id: string;
  name?: string;
  color?: string | null;
  icon?: string | null;
  position?: number;
}

export function handleMcpToolGroups(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_mcp_tool_groups":
      return Array.from(store.mcpToolGroups.values()).sort((a, b) =>
        Number(a.position - b.position),
      );
    case "get_mcp_tool_group": {
      const id = String(args["id"]);
      const g = store.mcpToolGroups.get(id);
      if (!g) throw { kind: "notFound", data: { entity: "mcp_tool_group", id } };
      return g;
    }
    case "create_mcp_tool_group": {
      const a = args as unknown as CreateArgs;
      const id = nextId("mtg");
      const ts = nowBig();
      const group: McpToolGroup = {
        id,
        name: a.name,
        color: a.color ?? null,
        icon: a.icon ?? null,
        position: BigInt(a.position ?? store.mcpToolGroups.size),
        createdAt: ts,
        updatedAt: ts,
      };
      store.mcpToolGroups.set(id, group);
      store.mcpToolGroupMembers.set(id, []);
      emitEvent("mcp_tool_group:created", { id });
      return group;
    }
    case "update_mcp_tool_group": {
      const a = args as unknown as UpdateArgs;
      const prev = store.mcpToolGroups.get(a.id);
      if (!prev) {
        throw { kind: "notFound", data: { entity: "mcp_tool_group", id: a.id } };
      }
      const next: McpToolGroup = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
        ...(a.position !== undefined ? { position: BigInt(a.position) } : {}),
        updatedAt: nowBig(),
      };
      store.mcpToolGroups.set(a.id, next);
      emitEvent("mcp_tool_group:updated", { id: a.id });
      return next;
    }
    case "delete_mcp_tool_group": {
      const id = String(args["id"]);
      store.mcpToolGroups.delete(id);
      store.mcpToolGroupMembers.delete(id);
      emitEvent("mcp_tool_group:deleted", { id });
      return null;
    }
    case "list_mcp_tool_group_members":
      return store.mcpToolGroupMembers.get(String(args["groupId"])) ?? [];
    case "add_mcp_tool_group_member": {
      const groupId = String(args["groupId"]);
      const toolId = String(args["mcpToolId"]);
      const members = store.mcpToolGroupMembers.get(groupId) ?? [];
      if (!members.includes(toolId)) members.push(toolId);
      store.mcpToolGroupMembers.set(groupId, members);
      emitEvent("mcp_tool_group:members_changed", { group_id: groupId });
      return null;
    }
    case "remove_mcp_tool_group_member": {
      const groupId = String(args["groupId"]);
      const toolId = String(args["mcpToolId"]);
      store.mcpToolGroupMembers.set(
        groupId,
        (store.mcpToolGroupMembers.get(groupId) ?? []).filter(
          (m) => m !== toolId,
        ),
      );
      emitEvent("mcp_tool_group:members_changed", { group_id: groupId });
      return null;
    }
    case "set_mcp_tool_group_members": {
      const groupId = String(args["groupId"]);
      store.mcpToolGroupMembers.set(groupId, [
        ...(args["orderedToolIds"] as string[]),
      ]);
      emitEvent("mcp_tool_group:members_changed", { group_id: groupId });
      return null;
    }
    // ── attach joins ──
    case "list_role_mcp_tool_groups":
      return store.roleMcpToolGroups.get(String(args["roleId"])) ?? [];
    case "set_role_mcp_tool_groups": {
      const roleId = String(args["roleId"]);
      store.roleMcpToolGroups.set(roleId, [...(args["groupIds"] as string[])]);
      emitEvent("role:updated", { id: roleId });
      return null;
    }
    case "list_board_mcp_tool_groups":
      return store.boardMcpToolGroups.get(String(args["boardId"])) ?? [];
    case "set_board_mcp_tool_groups": {
      const boardId = String(args["boardId"]);
      store.boardMcpToolGroups.set(boardId, [
        ...(args["groupIds"] as string[]),
      ]);
      emitEvent("board:updated", { id: boardId });
      return null;
    }
    case "list_task_mcp_tool_groups":
      return store.taskMcpToolGroups.get(String(args["taskId"])) ?? [];
    case "set_task_mcp_tool_groups": {
      const taskId = String(args["taskId"]);
      store.taskMcpToolGroups.set(taskId, [...(args["groupIds"] as string[])]);
      emitEvent("task:updated", { id: taskId });
      return null;
    }
    default:
      return undefined;
  }
}
