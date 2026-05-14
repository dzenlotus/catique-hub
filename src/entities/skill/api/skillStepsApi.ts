/**
 * Skill steps IPC client (SKILL-V2-A backend contract).
 *
 * Wraps the five Tauri commands SKILL-V2-A ships:
 *
 *  - `list_skill_steps(skillId)` → `SkillStep[]`
 *  - `add_skill_step(skillId, title, body, expectedOutcome?, position?)`
 *  - `update_skill_step(id, title?, body?, expectedOutcome?, position?)`
 *  - `delete_skill_step(id)`
 *  - `reorder_skill_steps(skillId, stepIds)`
 *
 * Argument keys are camelCase on the JS side; Tauri v2.x auto-converts
 * to snake_case for the Rust handler. Errors thrown by the underlying
 * Rust handler arrive as `AppError` and are re-thrown by
 * `invokeWithAppError` as `AppErrorInstance` so call-sites can branch
 * on `.error.kind` (matches the rest of the entity APIs).
 */

import { invokeWithAppError } from "@shared/api";
import type { SkillStep } from "@bindings/SkillStep";

/** `list_skill_steps` — every step for the given skill in `position` order. */
export async function listSkillSteps(skillId: string): Promise<SkillStep[]> {
  return invokeWithAppError<SkillStep[]>("list_skill_steps", { skillId });
}

export interface AddSkillStepArgs {
  skillId: string;
  title: string;
  body: string;
  /** Skip = `undefined`, set = string, clear-to-NULL = `null`. */
  expectedOutcome?: string | null;
  /** Skip = `undefined`. When omitted the backend appends. */
  position?: number;
}

/** `add_skill_step` — insert a new step row. */
export async function addSkillStep(args: AddSkillStepArgs): Promise<SkillStep> {
  const payload: Record<string, unknown> = {
    skillId: args.skillId,
    title: args.title,
    body: args.body,
  };
  if (args.expectedOutcome !== undefined) {
    payload.expectedOutcome = args.expectedOutcome;
  }
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<SkillStep>("add_skill_step", payload);
}

export interface UpdateSkillStepArgs {
  id: string;
  /** Skip = `undefined`. */
  title?: string;
  /** Skip = `undefined`. */
  body?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  expectedOutcome?: string | null;
  /** Skip = `undefined`. */
  position?: number;
}

/** `update_skill_step` — partial update by id. */
export async function updateSkillStep(
  args: UpdateSkillStepArgs,
): Promise<SkillStep> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.title !== undefined) payload.title = args.title;
  if (args.body !== undefined) payload.body = args.body;
  if (args.expectedOutcome !== undefined) {
    payload.expectedOutcome = args.expectedOutcome;
  }
  if (args.position !== undefined) payload.position = args.position;
  return invokeWithAppError<SkillStep>("update_skill_step", payload);
}

/** `delete_skill_step` — drop a single step row. */
export async function deleteSkillStep(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_skill_step", { id });
}

export interface ReorderSkillStepsArgs {
  skillId: string;
  /** New step order — `position` is rewritten to this array's index. */
  stepIds: string[];
}

/** `reorder_skill_steps` — rewrite `position` for every step on a skill. */
export async function reorderSkillSteps(
  args: ReorderSkillStepsArgs,
): Promise<void> {
  return invokeWithAppError<void>("reorder_skill_steps", {
    skillId: args.skillId,
    stepIds: args.stepIds,
  });
}
