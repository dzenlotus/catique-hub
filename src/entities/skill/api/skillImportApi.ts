/**
 * Skill import IPC client (SKILL-V2-A backend contract).
 *
 * Wraps the `import_skill_from_url` Tauri command. The backend:
 *   1. Performs an HTTP GET on the URL (allow-listed hosts:
 *      github.com / gitlab.com / gist.github.com).
 *   2. Parses the fetched markdown via an H2-splitter — the prelude
 *      becomes the skill `overview` (Skill.description / Skill.content),
 *      and each `## Heading` block becomes a step.
 *   3. When `replaceSteps` is true existing steps are deleted before
 *      the new ones are appended; when false the new steps are
 *      appended to the existing list.
 *   4. Returns an `ImportReport` so the caller can toast the outcome.
 *
 * `targetSkillId` is optional — backend may create a fresh skill when
 * omitted, but the editor always passes the current skill id (the
 * "Git import" entry point lives ON an existing skill page).
 */

import { invokeWithAppError } from "@shared/api";
import type { ImportReport } from "@bindings/ImportReport";

export interface ImportSkillFromUrlArgs {
  /** Source URL — `https://…` to a markdown file on an allow-listed host. */
  url: string;
  /** Existing skill to import into. Omit to create a new skill server-side. */
  targetSkillId?: string;
  /**
   * `true` → delete existing steps before importing. `false` (default)
   * → append. Maps to the backend's append/replace flag.
   */
  replaceSteps?: boolean;
}

/** `import_skill_from_url` — fetch + parse markdown into overview + steps. */
export async function importSkillFromUrl(
  args: ImportSkillFromUrlArgs,
): Promise<ImportReport> {
  const payload: Record<string, unknown> = { url: args.url };
  if (args.targetSkillId !== undefined) {
    payload.targetSkillId = args.targetSkillId;
  }
  if (args.replaceSteps !== undefined) {
    payload.replaceSteps = args.replaceSteps;
  }
  return invokeWithAppError<ImportReport>("import_skill_from_url", payload);
}
