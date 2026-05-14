/**
 * MCP tools command dispatcher (manual entries only — upstream-introspected
 * rows would be created by the create-server flow on the Rust side, which
 * is stubbed in `mcpServers.ts`).
 */

import type { McpTool } from "@bindings/McpTool";

import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateMcpToolArgs {
  name: string;
  description?: string | null;
  schemaJson: string;
  color?: string | null;
  position: number;
}

export function handleMcpTools(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_mcp_tools":
      return Array.from(store.mcpTools.values()).sort(
        (a, b) =>
          a.position - b.position || a.name.localeCompare(b.name),
      );
    case "get_mcp_tool": {
      const id = String(args["id"]);
      const t = store.mcpTools.get(id);
      if (!t) {
        throw {
          kind: "notFound",
          data: { entity: "mcp_tool", id },
        };
      }
      return t;
    }
    case "create_mcp_tool": {
      const a = args as unknown as CreateMcpToolArgs;
      const id = nextId("mcp-tool");
      const ts = nowBig();
      const tool: McpTool = {
        id,
        name: a.name,
        description: a.description ?? null,
        schemaJson: a.schemaJson,
        color: a.color ?? null,
        position: a.position,
        serverId: null,
        upstreamName: null,
        source: "manual",
        lastSyncedAt: null,
        createdAt: ts,
        updatedAt: ts,
      };
      store.mcpTools.set(id, tool);
      return tool;
    }
    case "update_mcp_tool":
      return null;
    case "delete_mcp_tool": {
      const id = String(args["id"]);
      store.mcpTools.delete(id);
      return null;
    }
    case "list_role_mcp_tools":
    case "list_task_mcp_tools":
      return [];
    case "add_task_mcp_tool":
    case "remove_task_mcp_tool":
      return null;
    default:
      return undefined;
  }
}
