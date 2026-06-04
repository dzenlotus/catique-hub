/**
 * MCP Servers IPC client.
 *
 * Wraps Tauri `invoke` calls for the `McpServer` aggregate introduced by
 * ADR-0008 (pass-through proxy). The shape mirrors
 * `entities/mcp-tool/api/mcpToolsApi.ts` — keys are camelCase on the JS
 * side (Tauri auto-converts to snake_case per v2.x convention).
 *
 * Errors thrown by the underlying Rust handler arrive here as a JSON-
 * serialised `AppError`. We rely on the shared
 * `invokeWithAppError` wrapper to unwrap and re-throw a typed
 * `AppErrorInstance` so call-sites can discriminate via `.error.kind`.
 *
 * Commands wrapped (PROXY-S4 + S6):
 *   - list_mcp_servers
 *   - get_mcp_server
 *   - create_mcp_server  (introspect-on-create runs server-side)
 *   - update_mcp_server
 *   - delete_mcp_server
 *   - refresh_mcp_server
 *   - get_mcp_server_status
 *   - list_mcp_tools_by_server
 */

import { invokeWithAppError } from "@shared/api";
import type { McpServer } from "@bindings/McpServer";
import type { McpServerStatus } from "@bindings/McpServerStatus";
import type { McpTool } from "@bindings/McpTool";
import type { RefreshReport } from "@bindings/RefreshReport";
import type { Transport } from "@bindings/Transport";

/** `list_mcp_servers` — return every registered MCP server. */
export async function listMcpServers(): Promise<McpServer[]> {
  return invokeWithAppError<McpServer[]>("list_mcp_servers");
}

/** `get_mcp_server` — fetch a single MCP server by id. */
export async function getMcpServer(id: string): Promise<McpServer> {
  return invokeWithAppError<McpServer>("get_mcp_server", { id });
}

export interface CreateMcpServerArgs {
  name: string;
  transport: Transport;
  /** Required when `transport ∈ {http, sse}`; ignored for stdio. */
  url?: string | null;
  /** Required when `transport === 'stdio'`; ignored for http/sse. */
  command?: string | null;
  /**
   * Auth-reference JSON; PROXY-S3 round 2 will wire keychain entries
   * through here. PROXY-S6 always passes `null` (see the
   * `// TODO(proxy-s3-r2)` comment in the create dialog).
   */
  authJson?: string | null;
  enabled: boolean;
}

/**
 * `create_mcp_server` — create an MCP server.
 *
 * The Rust handler runs `introspect_and_persist` best-effort
 * post-commit; failure of introspection leaves the row with status
 * `Unreachable` instead of rolling back.
 */
export async function createMcpServer(
  args: CreateMcpServerArgs,
): Promise<McpServer> {
  const payload: Record<string, unknown> = {
    name: args.name,
    transport: args.transport,
    url: args.url ?? null,
    command: args.command ?? null,
    authJson: args.authJson ?? null,
    enabled: args.enabled,
  };
  return invokeWithAppError<McpServer>("create_mcp_server", payload);
}

export interface UpdateMcpServerArgs {
  id: string;
  /** Skip = `undefined`. */
  name?: string;
  /** Skip = `undefined`. */
  transport?: Transport;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  url?: string | null;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  command?: string | null;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  authJson?: string | null;
  /** Skip = `undefined`. */
  enabled?: boolean;
}

/** `update_mcp_server` — partial update. */
export async function updateMcpServer(
  args: UpdateMcpServerArgs,
): Promise<McpServer> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.transport !== undefined) payload.transport = args.transport;
  if (args.url !== undefined) payload.url = args.url;
  if (args.command !== undefined) payload.command = args.command;
  if (args.authJson !== undefined) payload.authJson = args.authJson;
  if (args.enabled !== undefined) payload.enabled = args.enabled;
  return invokeWithAppError<McpServer>("update_mcp_server", payload);
}

/** `delete_mcp_server` — remove an MCP server. Cascades through tools. */
export async function deleteMcpServer(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_mcp_server", { id });
}

/**
 * `refresh_mcp_server` — re-runs `tools/list` against the upstream
 * server and reconciles the local inventory. Returns a count summary
 * the UI shows in a toast.
 */
export async function refreshMcpServer(id: string): Promise<RefreshReport> {
  return invokeWithAppError<RefreshReport>("refresh_mcp_server", { id });
}

/**
 * `get_mcp_server_status` — live status for one server. Backs the
 * green/amber/red dot in the server group header.
 */
export async function getMcpServerStatus(
  id: string,
): Promise<McpServerStatus> {
  return invokeWithAppError<McpServerStatus>("get_mcp_server_status", { id });
}

/**
 * `list_mcp_tools_by_server` — tools owned by one server. Includes
 * soft-deleted rows (`lastSyncedAt === null`); the UI renders them
 * with a strikethrough.
 */
export async function listMcpToolsByServer(
  serverId: string,
): Promise<McpTool[]> {
  return invokeWithAppError<McpTool[]>("list_mcp_tools_by_server", {
    serverId,
  });
}

// ── server-as-live-unit attachment (Phase C) ────────────────────────
// Attaching a server materialises ALL its tools into the scope's tasks
// and stays live across re-introspection.

/** `list_role_mcp_servers` — server ids attached to a role. */
export async function listRoleMcpServers(roleId: string): Promise<string[]> {
  return invokeWithAppError<string[]>("list_role_mcp_servers", { roleId });
}

/** `set_role_mcp_servers` — replace a role's attached servers. */
export async function setRoleMcpServers(
  roleId: string,
  serverIds: string[],
): Promise<void> {
  return invokeWithAppError<void>("set_role_mcp_servers", { roleId, serverIds });
}

/** `list_board_mcp_servers` — server ids attached to a board. */
export async function listBoardMcpServers(boardId: string): Promise<string[]> {
  return invokeWithAppError<string[]>("list_board_mcp_servers", { boardId });
}

/** `set_board_mcp_servers` — replace a board's attached servers. */
export async function setBoardMcpServers(
  boardId: string,
  serverIds: string[],
): Promise<void> {
  return invokeWithAppError<void>("set_board_mcp_servers", {
    boardId,
    serverIds,
  });
}

/** `list_task_mcp_servers` — server ids attached to a task. */
export async function listTaskMcpServers(taskId: string): Promise<string[]> {
  return invokeWithAppError<string[]>("list_task_mcp_servers", { taskId });
}

/** `set_task_mcp_servers` — replace a task's attached servers. */
export async function setTaskMcpServers(
  taskId: string,
  serverIds: string[],
): Promise<void> {
  return invokeWithAppError<void>("set_task_mcp_servers", { taskId, serverIds });
}
