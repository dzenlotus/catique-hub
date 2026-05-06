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

import { invokeWithAppError } from "@shared/api";
import type { Role } from "@bindings/Role";
import type { Prompt } from "@bindings/Prompt";
import type { Skill } from "@bindings/Skill";
import type { McpTool } from "@bindings/McpTool";

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
  /** Pixel-icon identifier (matches `@shared/ui/Icon` keys). */
  icon?: string;
}

/** `create_role` — create a new role.
 *  Note: `content` is required at the Tauri command boundary (Rust
 *  side has it as non-optional `String`); we default to empty string
 *  when the caller omits it, matching the previous "defaults to empty
 *  on the Rust side" docstring contract. */
export async function createRole(args: CreateRoleArgs): Promise<Role> {
  const payload: Record<string, unknown> = {
    name: args.name,
    content: args.content ?? "",
  };
  if (args.color !== undefined) payload.color = args.color;
  if (args.icon !== undefined) payload.icon = args.icon;
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

export interface AddRolePromptArgs {
  roleId: string;
  promptId: string;
  position: number;
}

/**
 * `add_role_prompt` — attach a prompt to a role at the given position.
 * Throws AppError `transactionRolledBack` on FK violation.
 */
export async function addRolePrompt(args: AddRolePromptArgs): Promise<void> {
  return invokeWithAppError<void>("add_role_prompt", {
    roleId: args.roleId,
    promptId: args.promptId,
    position: args.position,
  });
}

export interface RemoveRolePromptArgs {
  roleId: string;
  promptId: string;
}

/**
 * `remove_role_prompt` — detach a prompt from a role.
 * Throws AppError `notFound` when the join row is absent.
 */
export async function removeRolePrompt(
  args: RemoveRolePromptArgs,
): Promise<void> {
  return invokeWithAppError<void>("remove_role_prompt", {
    roleId: args.roleId,
    promptId: args.promptId,
  });
}

/**
 * `list_role_prompts` — prompts attached to a role, ordered by position.
 *
 * TODO(ctq-117): backend handler not yet implemented. Until it lands,
 * the IPC call will reject — `useRolePrompts` surfaces an empty list on
 * error so the UI degrades gracefully.
 */
export async function listRolePrompts(roleId: string): Promise<Prompt[]> {
  return invokeWithAppError<Prompt[]>("list_role_prompts", { roleId });
}

/**
 * `set_role_prompts` — replace the role's full prompt ordering with the
 * provided id list. Used by drag-reorder.
 *
 * TODO(ctq-108): backend handler not yet implemented. Frontend uses this
 * for optimistic reorder + rollback; expect a transient error toast
 * until the bulk setter ships.
 */
export async function setRolePrompts(
  roleId: string,
  promptIds: string[],
): Promise<void> {
  return invokeWithAppError<void>("set_role_prompts", {
    roleId,
    promptIds,
  });
}

export interface AddRoleSkillArgs {
  roleId: string;
  skillId: string;
  position: number;
}

/** `add_role_skill` — attach a skill to a role at the given position. */
export async function addRoleSkill(args: AddRoleSkillArgs): Promise<void> {
  return invokeWithAppError<void>("add_role_skill", {
    roleId: args.roleId,
    skillId: args.skillId,
    position: args.position,
  });
}

export interface RemoveRoleSkillArgs {
  roleId: string;
  skillId: string;
}

/** `remove_role_skill` — detach a skill from a role. */
export async function removeRoleSkill(
  args: RemoveRoleSkillArgs,
): Promise<void> {
  return invokeWithAppError<void>("remove_role_skill", {
    roleId: args.roleId,
    skillId: args.skillId,
  });
}

/**
 * `list_role_skills` — skills attached to a role, ordered by position.
 *
 * TODO(ctq-117): backend handler not yet implemented.
 */
export async function listRoleSkills(roleId: string): Promise<Skill[]> {
  return invokeWithAppError<Skill[]>("list_role_skills", { roleId });
}

/**
 * `setRoleSkills` — bulk set the skill list for a role via diff.
 *
 * No `set_role_skills` IPC exists yet (audit-#8) so this composite
 * computes a diff against `previous` and dispatches the existing
 * `add_role_skill` / `remove_role_skill` commands.
 */
export async function setRoleSkills(
  roleId: string,
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): Promise<void> {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const toRemove = previous.filter((id) => !nextSet.has(id));
  const toAdd = next.filter((id) => !previousSet.has(id));
  for (const skillId of toRemove) {
    await removeRoleSkill({ roleId, skillId });
  }
  let position = previous.length - toRemove.length;
  for (const skillId of toAdd) {
    await addRoleSkill({ roleId, skillId, position });
    position += 1;
  }
}

export interface AddRoleMcpToolArgs {
  roleId: string;
  mcpToolId: string;
  position: number;
}

/** `add_role_mcp_tool` — attach an MCP tool to a role at the given position. */
export async function addRoleMcpTool(args: AddRoleMcpToolArgs): Promise<void> {
  return invokeWithAppError<void>("add_role_mcp_tool", {
    roleId: args.roleId,
    mcpToolId: args.mcpToolId,
    position: args.position,
  });
}

export interface RemoveRoleMcpToolArgs {
  roleId: string;
  mcpToolId: string;
}

/** `remove_role_mcp_tool` — detach an MCP tool from a role. */
export async function removeRoleMcpTool(
  args: RemoveRoleMcpToolArgs,
): Promise<void> {
  return invokeWithAppError<void>("remove_role_mcp_tool", {
    roleId: args.roleId,
    mcpToolId: args.mcpToolId,
  });
}

/**
 * `list_role_mcp_tools` — MCP tools attached to a role, ordered by position.
 *
 * TODO(ctq-117): backend handler not yet implemented.
 */
export async function listRoleMcpTools(roleId: string): Promise<McpTool[]> {
  return invokeWithAppError<McpTool[]>("list_role_mcp_tools", { roleId });
}

/**
 * `setRoleMcpTools` — bulk set the MCP-tool list for a role via diff.
 * Same shape as {@link setRoleSkills} — no bulk IPC, walk the difference
 * against the per-row commands.
 */
export async function setRoleMcpTools(
  roleId: string,
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): Promise<void> {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const toRemove = previous.filter((id) => !nextSet.has(id));
  const toAdd = next.filter((id) => !previousSet.has(id));
  for (const mcpToolId of toRemove) {
    await removeRoleMcpTool({ roleId, mcpToolId });
  }
  let position = previous.length - toRemove.length;
  for (const mcpToolId of toAdd) {
    await addRoleMcpTool({ roleId, mcpToolId, position });
    position += 1;
  }
}
