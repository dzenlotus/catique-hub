/**
 * Skills IPC client.
 *
 * Wraps Tauri `invoke` calls for the `Skill` aggregate. Argument shape
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

import { invokeWithAppError } from "@shared/api";
import type { Skill } from "@bindings/Skill";

/** `list_skills` — return every skill. */
export async function listSkills(): Promise<Skill[]> {
  return invokeWithAppError<Skill[]>("list_skills");
}

/** `get_skill` — fetch a single skill by id. */
export async function getSkill(id: string): Promise<Skill> {
  return invokeWithAppError<Skill>("get_skill", { id });
}

export interface CreateSkillArgs {
  name: string;
  description?: string;
  color?: string;
  /**
   * Sort rank assigned to the new skill.  Required by the Rust handler
   * (`crates/api/src/handlers/skills.rs::create_skill` takes a non-optional
   * `position: f64`); omitting it triggers a serde error before the
   * handler body runs.  Callers default to a monotonically-increasing
   * value (`Date.now()`) so each new row lands at the end of the list.
   */
  position: number;
}

/** `create_skill` — create a new skill. */
export async function createSkill(args: CreateSkillArgs): Promise<Skill> {
  const payload: Record<string, unknown> = {
    name: args.name,
    position: args.position,
  };
  if (args.description !== undefined) payload.description = args.description;
  if (args.color !== undefined) payload.color = args.color;
  return invokeWithAppError<Skill>("create_skill", payload);
}

export interface UpdateSkillArgs {
  id: string;
  /** Skip = `undefined`. */
  name?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  description?: string | null;
  /** Skip = `undefined`, set = string, clear-to-NULL = `null`. */
  color?: string | null;
  /** Skip = `undefined`. */
  position?: number;
}

/** `update_skill` — partial update. */
export async function updateSkill(args: UpdateSkillArgs): Promise<Skill> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.description !== undefined) payload.description = args.description;
  if (args.color !== undefined) payload.color = args.color;
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<Skill>("update_skill", payload);
}

/** `delete_skill` — remove a skill. */
export async function deleteSkill(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_skill", { id });
}
