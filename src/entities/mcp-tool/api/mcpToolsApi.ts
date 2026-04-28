/**
 * MCP Tools IPC client.
 *
 * Wraps Tauri `invoke` calls for the `McpTool` aggregate. Argument shape
 * follows the contract the Rust side accepts: keys are camelCase on
 * the JS side (Tauri auto-converts to snake_case for Rust per the
 * v2.x convention).
 *
 * Errors thrown by the underlying Rust handler arrive here as a JSON-
 * serialised `AppError`. We unwrap and re-throw a typed
 * `AppErrorInstance` (imported from `@entities/board`) so call-sites
 * get a discriminated union via `.error.kind`.
 *
 * Mirrors `entities/role/api/rolesApi.ts` — imports
 * `AppErrorInstance` from `@entities/board` and locally defines
 * `isAppErrorShape` + `invokeWithAppError`.
 */

import { invoke } from "@shared/api";
import { AppErrorInstance } from "@entities/board";
import type { AppError } from "@bindings/AppError";
import type { McpTool } from "@bindings/McpTool";

/** Same `AppError` discriminator used in `boardsApi` / `rolesApi`. */
function isAppErrorShape(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string") return false;
  return (
    kind === "validation" ||
    kind === "transactionRolledBack" ||
    kind === "dbBusy" ||
    kind === "lockTimeout" ||
    kind === "internalPanic" ||
    kind === "notFound" ||
    kind === "conflict" ||
    kind === "secretAccessDenied"
  );
}

async function invokeWithAppError<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (isAppErrorShape(raw)) {
      throw new AppErrorInstance(raw);
    }
    throw raw;
  }
}

/** `list_mcp_tools` — return every MCP tool. */
export async function listMcpTools(): Promise<McpTool[]> {
  return invokeWithAppError<McpTool[]>("list_mcp_tools");
}

/** `get_mcp_tool` — fetch a single MCP tool by id. */
export async function getMcpTool(id: string): Promise<McpTool> {
  return invokeWithAppError<McpTool>("get_mcp_tool", { id });
}

export interface CreateMcpToolArgs {
  name: string;
  description?: string;
  schemaJson: string;
  color?: string;
}

/** `create_mcp_tool` — create a new MCP tool. */
export async function createMcpTool(args: CreateMcpToolArgs): Promise<McpTool> {
  const payload: Record<string, unknown> = {
    name: args.name,
    schemaJson: args.schemaJson,
  };
  if (args.description !== undefined) payload.description = args.description;
  if (args.color !== undefined) payload.color = args.color;
  return invokeWithAppError<McpTool>("create_mcp_tool", payload);
}

export interface UpdateMcpToolArgs {
  id: string;
  /** Skip = `undefined`. */
  name?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  description?: string | null;
  /** Skip = `undefined`. */
  schemaJson?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  color?: string | null;
  /** Skip = `undefined`. */
  position?: number;
}

/** `update_mcp_tool` — partial update. */
export async function updateMcpTool(args: UpdateMcpToolArgs): Promise<McpTool> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.description !== undefined) payload.description = args.description;
  if (args.schemaJson !== undefined) payload.schemaJson = args.schemaJson;
  if (args.color !== undefined) payload.color = args.color;
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<McpTool>("update_mcp_tool", payload);
}

/** `delete_mcp_tool` — remove an MCP tool. */
export async function deleteMcpTool(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_mcp_tool", { id });
}
