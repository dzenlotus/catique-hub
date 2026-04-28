/**
 * Roles IPC client.
 *
 * Wraps Tauri `invoke` calls for the `Role` aggregate. Argument shape
 * follows the contract the Rust side accepts: keys are camelCase on
 * the JS side (Tauri auto-converts to snake_case for Rust per the
 * v2.x convention).
 *
 * Errors thrown by the underlying Rust handler arrive here as a JSON-
 * serialised `AppError`. We unwrap and re-throw a typed
 * `AppErrorInstance` (imported from `@entities/board`) so call-sites
 * get a discriminated union via `.error.kind`.
 *
 * Mirrors `entities/column/api/columnsApi.ts` — imports
 * `AppErrorInstance` from `@entities/board` and locally defines
 * `isAppErrorShape` + `invokeWithAppError`.
 */

import { invoke } from "@shared/api";
import { AppErrorInstance } from "@entities/board";
import type { AppError } from "@bindings/AppError";
import type { Role } from "@bindings/Role";

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

/** `list_roles` — return every role. */
export async function listRoles(): Promise<Role[]> {
  return invokeWithAppError<Role[]>("list_roles");
}

/** `get_role` — fetch a single role by id. */
export async function getRole(id: string): Promise<Role> {
  return invokeWithAppError<Role>("get_role", { id });
}

export interface CreateRoleArgs {
  name: string;
  /** Defaults to empty string on the Rust side when omitted. */
  content?: string;
  color?: string;
}

/** `create_role` — create a new role. */
export async function createRole(args: CreateRoleArgs): Promise<Role> {
  const payload: Record<string, unknown> = { name: args.name };
  if (args.content !== undefined) payload.content = args.content;
  if (args.color !== undefined) payload.color = args.color;
  return invokeWithAppError<Role>("create_role", payload);
}

export interface UpdateRoleArgs {
  id: string;
  /** Skip = `undefined`. */
  name?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  color?: string | null;
  /** Skip = `undefined`, clear-to-NULL = `null`. */
  content?: string | null;
}

/** `update_role` — partial update. */
export async function updateRole(args: UpdateRoleArgs): Promise<Role> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.color !== undefined) payload.color = args.color;
  if (args.content !== undefined) payload.content = args.content;
  return invokeWithAppError<Role>("update_role", payload);
}

/** `delete_role` — remove a role. */
export async function deleteRole(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_role", { id });
}
