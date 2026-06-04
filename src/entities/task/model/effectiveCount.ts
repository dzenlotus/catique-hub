/**
 * `effectiveCount` — combined effective-context badge for a kanban task.
 *
 * Returns `effective_prompt_count + effective_skill_count +
 * effective_tool_count` as a JS `number`. The Rust struct exposes these
 * counters as `i64` / `bigint` on the TS side (ts-rs binding) so the
 * card surface sums them down into a single chip.
 *
 * Per Project Map v3 §"Effective context performance" the kanban card
 * shows one combined number; the per-kind breakdown lives on the task
 * detail panel (`EffectiveContextPanel`).
 *
 * The denormalised counters are kept in sync with every override / direct
 * attach mutation on the Rust side (refactor-v3 D-B); the frontend trusts
 * the value as-is.
 */

import type { Task } from "./types";

export function effectiveCount(task: Task): number {
  // bigint → number is safe here: counters are bounded by the number of
  // rows reachable from a task across prompts/skills/tools — far below
  // Number.MAX_SAFE_INTEGER (2^53 − 1) for any realistic install.
  return (
    Number(task.effectivePromptCount) +
    Number(task.effectiveSkillCount) +
    Number(task.effectiveToolCount)
  );
}
