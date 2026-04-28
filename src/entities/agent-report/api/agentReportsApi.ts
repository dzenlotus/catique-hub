/**
 * Agent Reports IPC client.
 *
 * Wraps Tauri `invoke` calls for the `AgentReport` aggregate. Argument
 * shapes follow the contract the Rust side accepts: keys are camelCase
 * on the JS side (Tauri auto-converts to snake_case for Rust per the
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
import type { AgentReport } from "@bindings/AgentReport";

/** Same `AppError` discriminator used in `boardsApi` / `columnsApi`. */
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

/** `list_agent_reports` — return every report (newest first). */
export async function listAgentReports(): Promise<AgentReport[]> {
  return invokeWithAppError<AgentReport[]>("list_agent_reports");
}

/** `get_agent_report` — fetch a single report by id. */
export async function getAgentReport(id: string): Promise<AgentReport> {
  return invokeWithAppError<AgentReport>("get_agent_report", { id });
}

export interface CreateAgentReportArgs {
  taskId: string;
  kind: string;
  title: string;
  content: string;
  author?: string;
}

/** `create_agent_report` — create a new report. */
export async function createAgentReport(
  args: CreateAgentReportArgs,
): Promise<AgentReport> {
  const payload: Record<string, unknown> = {
    taskId: args.taskId,
    kind: args.kind,
    title: args.title,
    content: args.content,
  };
  if (args.author !== undefined) payload.author = args.author;
  return invokeWithAppError<AgentReport>("create_agent_report", payload);
}

export interface UpdateAgentReportArgs {
  id: string;
  /** Skip = `undefined`. */
  kind?: string;
  /** Skip = `undefined`. */
  title?: string;
  /** Skip = `undefined`, clear-to-NULL = `null`. */
  content?: string;
  /** Skip = `undefined`, clear-to-NULL = `null`. */
  author?: string | null;
}

/** `update_agent_report` — partial update. */
export async function updateAgentReport(
  args: UpdateAgentReportArgs,
): Promise<AgentReport> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.kind !== undefined) payload.kind = args.kind;
  if (args.title !== undefined) payload.title = args.title;
  if (args.content !== undefined) payload.content = args.content;
  if (args.author !== undefined) payload.author = args.author;
  return invokeWithAppError<AgentReport>("update_agent_report", payload);
}

/** `delete_agent_report` — remove a report. */
export async function deleteAgentReport(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_agent_report", { id });
}
