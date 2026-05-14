/**
 * Role notes IPC client (ctq-137 / MEM-S2).
 *
 * Wraps Tauri `invoke` calls for the `RoleNote` aggregate. Argument
 * shape follows the contract the Rust side accepts: keys are camelCase
 * on the JS side (Tauri auto-converts to snake_case for Rust per the
 * v2.x convention).
 *
 * Errors thrown by the underlying Rust handler arrive here as a JSON-
 * serialised `AppError`. We unwrap and re-throw a typed
 * `AppErrorInstance` (imported from `@entities/board`) so call-sites
 * get a discriminated union via `.error.kind`.
 *
 * Mirrors `entities/role/api/rolesApi.ts` — imports `AppErrorInstance`
 * from `@entities/board` and locally defines `isAppErrorShape` +
 * `invokeWithAppError`.
 */

import { invoke } from "@shared/api";
import { AppErrorInstance } from "@entities/board";
import type { AppError } from "@bindings/AppError";
import type { RoleNote } from "@bindings/RoleNote";
import type { RoleNoteAuthor } from "@bindings/RoleNoteAuthor";

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

/** Tag count returned by `list_role_note_tags`. */
export interface RoleNoteTagCount {
  tag: string;
  count: number;
}

/** `list_role_notes` — every note for a role. */
export async function listRoleNotes(roleId: string): Promise<RoleNote[]> {
  return invokeWithAppError<RoleNote[]>("list_role_notes", { roleId });
}

/** `list_role_note_tags` — tag counts for a role's notes. */
export async function listRoleNoteTags(
  roleId: string,
): Promise<RoleNoteTagCount[]> {
  return invokeWithAppError<RoleNoteTagCount[]>("list_role_note_tags", {
    roleId,
  });
}

/** `get_role_note` — fetch a single note by id. */
export async function getRoleNote(id: string): Promise<RoleNote> {
  return invokeWithAppError<RoleNote>("get_role_note", { id });
}

export interface AddRoleNoteArgs {
  roleId: string;
  body: string;
  tags: string[];
  sourceTaskId?: string;
  authoredBy: RoleNoteAuthor;
}

/** `add_role_note` — append a curation note to a role's memory. */
export async function addRoleNote(args: AddRoleNoteArgs): Promise<RoleNote> {
  const payload: Record<string, unknown> = {
    roleId: args.roleId,
    body: args.body,
    tags: args.tags,
    authoredBy: args.authoredBy,
  };
  if (args.sourceTaskId !== undefined) {
    payload.sourceTaskId = args.sourceTaskId;
  }
  return invokeWithAppError<RoleNote>("add_role_note", payload);
}

export interface UpdateRoleNoteArgs {
  id: string;
  /** Skip = `undefined`. */
  body?: string;
  /** Skip = `undefined`. */
  tags?: string[];
  /** Skip = `undefined`. Clamped 0..10 on the Rust side. */
  priority?: number;
  /** Skip = `undefined`. */
  pinned?: boolean;
}

/** `update_role_note` — partial update on a note. */
export async function updateRoleNote(
  args: UpdateRoleNoteArgs,
): Promise<RoleNote> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.body !== undefined) payload.body = args.body;
  if (args.tags !== undefined) payload.tags = args.tags;
  if (args.priority !== undefined) payload.priority = args.priority;
  if (args.pinned !== undefined) payload.pinned = args.pinned;
  return invokeWithAppError<RoleNote>("update_role_note", payload);
}

/** `delete_role_note` — remove a note. */
export async function deleteRoleNote(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_role_note", { id });
}
