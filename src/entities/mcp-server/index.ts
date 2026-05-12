/**
 * `entities/mcp-server` — public surface (FSD encapsulation).
 *
 * Introduced with PROXY-S6 / ADR-0008. Models the upstream MCP
 * servers the user registers in Catique HUB. Their tool inventory is
 * exposed via `useMcpToolsByServer` (lives here because the IPC is
 * server-scoped and the invalidation chain follows `mcp_server:*`
 * events).
 *
 * Internal modules under `./api` and `./model` MUST NOT be imported
 * directly from outside this slice. Anything not re-exported here is
 * private to the entity.
 */

// API
export {
  listMcpServers,
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  refreshMcpServer,
  getMcpServerStatus,
  listMcpToolsByServer,
} from "./api";
export type {
  CreateMcpServerArgs,
  UpdateMcpServerArgs,
} from "./api";

// Model
export {
  mcpServersKeys,
  useMcpServers,
  useMcpServer,
  useMcpServerStatus,
  useMcpToolsByServer,
  useCreateMcpServerMutation,
  useUpdateMcpServerMutation,
  useRefreshMcpServerMutation,
  useDeleteMcpServerMutation,
} from "./model";
export type {
  McpServer,
  McpServerStatus,
  McpServerHealthState,
  RefreshReport,
  Transport,
} from "./model";
