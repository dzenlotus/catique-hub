/**
 * PromptGroups IPC client.
 *
 * Wraps Tauri `invoke` calls for the `PromptGroup` aggregate. Argument shape
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
import type { PromptGroup } from "@bindings/PromptGroup";

/** Same `AppError` discriminator used in `boardsApi` / `columnsApi` / `rolesApi`. */
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

/** `list_prompt_groups` — return every prompt group. */
export async function listPromptGroups(): Promise<PromptGroup[]> {
  return invokeWithAppError<PromptGroup[]>("list_prompt_groups");
}

/** `get_prompt_group` — fetch a single prompt group by id. */
export async function getPromptGroup(id: string): Promise<PromptGroup> {
  return invokeWithAppError<PromptGroup>("get_prompt_group", { id });
}

export interface CreatePromptGroupArgs {
  name: string;
  color?: string;
  position?: bigint;
}

/** `create_prompt_group` — create a new prompt group. */
export async function createPromptGroup(
  args: CreatePromptGroupArgs,
): Promise<PromptGroup> {
  const payload: Record<string, unknown> = { name: args.name };
  if (args.color !== undefined) payload.color = args.color;
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<PromptGroup>("create_prompt_group", payload);
}

export interface UpdatePromptGroupArgs {
  id: string;
  /** Skip = `undefined`. */
  name?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  color?: string | null;
  /** Skip = `undefined`. */
  position?: bigint;
}

/** `update_prompt_group` — partial update. */
export async function updatePromptGroup(
  args: UpdatePromptGroupArgs,
): Promise<PromptGroup> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.color !== undefined) payload.color = args.color;
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<PromptGroup>("update_prompt_group", payload);
}

/** `delete_prompt_group` — remove a prompt group. */
export async function deletePromptGroup(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_prompt_group", { id });
}

/** `list_prompt_group_members` — return ordered prompt ids for a group. */
export async function listPromptGroupMembers(
  groupId: string,
): Promise<string[]> {
  return invokeWithAppError<string[]>("list_prompt_group_members", { groupId });
}

export interface AddPromptGroupMemberArgs {
  groupId: string;
  promptId: string;
  position: bigint;
}

/** `add_prompt_group_member` — add a prompt to the group at a given position. */
export async function addPromptGroupMember(
  args: AddPromptGroupMemberArgs,
): Promise<void> {
  return invokeWithAppError<void>("add_prompt_group_member", {
    groupId: args.groupId,
    promptId: args.promptId,
    position: args.position,
  });
}

export interface RemovePromptGroupMemberArgs {
  groupId: string;
  promptId: string;
}

/** `remove_prompt_group_member` — remove a prompt from the group. */
export async function removePromptGroupMember(
  args: RemovePromptGroupMemberArgs,
): Promise<void> {
  return invokeWithAppError<void>("remove_prompt_group_member", {
    groupId: args.groupId,
    promptId: args.promptId,
  });
}

export interface SetPromptGroupMembersArgs {
  groupId: string;
  orderedPromptIds: string[];
}

/** `set_prompt_group_members` — replace the entire ordered member list. */
export async function setPromptGroupMembers(
  args: SetPromptGroupMembersArgs,
): Promise<void> {
  return invokeWithAppError<void>("set_prompt_group_members", {
    groupId: args.groupId,
    orderedPromptIds: args.orderedPromptIds,
  });
}
