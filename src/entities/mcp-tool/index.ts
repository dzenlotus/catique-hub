/**
 * `entities/mcp-tool` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listMcpTools,
  getMcpTool,
  createMcpTool,
  updateMcpTool,
  deleteMcpTool,
} from "./api";
export type { CreateMcpToolArgs, UpdateMcpToolArgs } from "./api";

// Model
export {
  mcpToolsKeys,
  useMcpTools,
  useMcpTool,
  useCreateMcpToolMutation,
  useUpdateMcpToolMutation,
  useDeleteMcpToolMutation,
} from "./model";
export type { McpTool } from "./model";

// UI
export { McpToolCard } from "./ui";
export type { McpToolCardProps } from "./ui";
