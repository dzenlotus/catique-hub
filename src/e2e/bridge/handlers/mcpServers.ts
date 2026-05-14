/**
 * MCP servers command dispatcher.
 *
 * Status reads always return a deterministic "healthy" stub so the
 * post-create one-shot poll resolves without flakiness. The full
 * introspect-on-create / refresh path is not modeled — iteration-1
 * scenarios verify the row appears in the sidebar, not the upstream
 * tool inventory.
 */

import type { McpServer } from "@bindings/McpServer";
import type { McpServerStatus } from "@bindings/McpServerStatus";
import type { RefreshReport } from "@bindings/RefreshReport";
import type { Transport } from "@bindings/Transport";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateMcpServerArgs {
  name: string;
  transport: Transport;
  url?: string | null;
  command?: string | null;
  authJson?: string | null;
  enabled: boolean;
}

interface UpdateMcpServerArgs {
  id: string;
  name?: string;
  transport?: Transport;
  url?: string | null;
  command?: string | null;
  authJson?: string | null;
  enabled?: boolean;
}

export function handleMcpServers(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_mcp_servers":
      return Array.from(store.mcpServers.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    case "get_mcp_server": {
      const id = String(args["id"]);
      const s = store.mcpServers.get(id);
      if (!s) {
        throw {
          kind: "notFound",
          data: { entity: "mcp_server", id },
        };
      }
      return s;
    }
    case "create_mcp_server": {
      const a = args as unknown as CreateMcpServerArgs;
      const id = nextId("mcp-server");
      const ts = nowBig();
      const server: McpServer = {
        id,
        name: a.name,
        transport: a.transport,
        url: a.url ?? null,
        command: a.command ?? null,
        authJson: a.authJson ?? null,
        enabled: a.enabled,
        createdAt: ts,
        updatedAt: ts,
      };
      store.mcpServers.set(id, server);
      emitEvent("mcp_server:created", { id });
      return server;
    }
    case "update_mcp_server": {
      const a = args as unknown as UpdateMcpServerArgs;
      const prev = store.mcpServers.get(a.id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "mcp_server", id: a.id },
        };
      }
      const next: McpServer = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.transport !== undefined ? { transport: a.transport } : {}),
        ...(a.url !== undefined ? { url: a.url } : {}),
        ...(a.command !== undefined ? { command: a.command } : {}),
        ...(a.authJson !== undefined ? { authJson: a.authJson } : {}),
        ...(a.enabled !== undefined ? { enabled: a.enabled } : {}),
        updatedAt: nowBig(),
      };
      store.mcpServers.set(a.id, next);
      emitEvent("mcp_server:updated", { id: a.id });
      return next;
    }
    case "delete_mcp_server": {
      const id = String(args["id"]);
      store.mcpServers.delete(id);
      emitEvent("mcp_server:deleted", { id });
      return null;
    }
    case "list_mcp_tools_by_server":
      // No upstream introspection modeled — empty list is fine.
      return [];
    case "get_mcp_server_status": {
      const id = String(args["serverId"] ?? args["id"]);
      const status: McpServerStatus = {
        serverId: id,
        state: "healthy",
        lastSyncedAt: nowBig(),
        toolCount: 0n,
        lastCallStartedAt: null,
        lastCallSuccess: null,
      };
      return status;
    }
    case "refresh_mcp_server": {
      const report: RefreshReport = {
        added: 0n,
        schemaChanged: 0n,
        stillPresent: 0n,
        softDeleted: 0n,
      };
      return report;
    }
    case "get_mcp_server_connection_hint":
      return null;
    default:
      return undefined;
  }
}
