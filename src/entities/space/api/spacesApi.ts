/**
 * Spaces IPC client.
 *
 * Wraps Tauri `invoke` calls for the `Space` aggregate. Argument shape
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
import type { Space } from "@bindings/Space";

/**
 * Validate a space prefix client-side.
 *
 * Rules (mirroring Rust domain validation):
 *   - Lowercase ASCII letters, digits, and hyphens only.
 *   - Length 1–10 characters.
 *   - Must not start or end with a hyphen.
 *
 * Rust enforces the definitive constraint; this helper lets widgets
 * (SpaceCreateDialog, settings) surface errors before the IPC round-trip.
 *
 * Returns `null` when valid, or a human-readable error string when invalid.
 */
export function validatePrefix(prefix: string): string | null {
  if (prefix.length === 0) return "Prefix must not be empty.";
  if (prefix.length > 10) return "Prefix must be 10 characters or fewer.";
  if (!/^[a-z0-9-]+$/.test(prefix)) {
    return "Prefix may only contain lowercase letters (a–z), digits (0–9), and hyphens.";
  }
  if (prefix.startsWith("-") || prefix.endsWith("-")) {
    return "Prefix must not start or end with a hyphen.";
  }
  return null;
}

/** `list_spaces` — return every space, ordered by `(position, name)`. */
export async function listSpaces(): Promise<Space[]> {
  return invokeWithAppError<Space[]>("list_spaces");
}

/** `get_space` — fetch a single space by id. */
export async function getSpace(id: string): Promise<Space> {
  return invokeWithAppError<Space>("get_space", { id });
}

export interface CreateSpaceArgs {
  name: string;
  /** Lowercase a–z, digits, hyphens; length 1–10. */
  prefix: string;
  description?: string;
  /** Optional CSS hex color (`#RRGGBB`). */
  color?: string;
  /** Optional pixel-icon identifier (matches `@shared/ui/Icon`). */
  icon?: string;
  /** When true, this space becomes the default. Defaults to false. */
  isDefault?: boolean;
  /**
   * Round-21: optional absolute path to the project folder this space
   * represents on disk. Used by the "Reveal in Finder" affordance in
   * SpaceSettings; never piped into prompts.
   *
   * TODO(round-21-backend, migration 020): backend handler must accept
   * `projectFolderPath?: string | null` on `create_space`.
   */
  projectFolderPath?: string;
}

/** `create_space` — create a new space. */
export async function createSpace(args: CreateSpaceArgs): Promise<Space> {
  const payload: Record<string, unknown> = {
    name: args.name,
    prefix: args.prefix,
    isDefault: args.isDefault ?? false,
  };
  if (args.description !== undefined) payload.description = args.description;
  if (args.color !== undefined) payload.color = args.color;
  if (args.icon !== undefined) payload.icon = args.icon;
  if (args.projectFolderPath !== undefined) {
    payload.projectFolderPath = args.projectFolderPath;
  }
  return invokeWithAppError<Space>("create_space", payload);
}

export interface UpdateSpaceArgs {
  id: string;
  /** Skip = `undefined`. */
  name?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  description?: string | null;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  color?: string | null;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`.
   * Mirrors Rust's `Option<Option<String>>`.
   */
  icon?: string | null;
  /** Skip = `undefined`. */
  isDefault?: boolean;
  /** Skip = `undefined`. */
  position?: number;
  /**
   * Round-21: optional absolute path to the project folder this space
   * represents on disk. Skip = `undefined`, set = string,
   * clear-to-NULL = `null` (mirrors Rust's `Option<Option<String>>`).
   *
   * TODO(round-21-backend, migration 020): backend handler must accept
   * `projectFolderPath?: string | null` on `update_space`.
   */
  projectFolderPath?: string | null;
}

/** `update_space` — partial update. Note: `prefix` is not updatable. */
export async function updateSpace(args: UpdateSpaceArgs): Promise<Space> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.description !== undefined) payload.description = args.description;
  if (args.color !== undefined) payload.color = args.color;
  if (args.icon !== undefined) payload.icon = args.icon;
  if (args.isDefault !== undefined) payload.isDefault = args.isDefault;
  if (args.position !== undefined) payload.position = args.position;
  if (args.projectFolderPath !== undefined) {
    payload.projectFolderPath = args.projectFolderPath;
  }
  return invokeWithAppError<Space>("update_space", payload);
}

/** `delete_space` — remove a space by id. */
export async function deleteSpace(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_space", { id });
}

/**
 * `list_space_prompts` — prompts attached to a space at the project
 * scope. Surfaced in board / agent settings so the user can see what
 * is already cascading from the space before adding board-level
 * attachments.
 */
export async function listSpacePrompts(
  spaceId: string,
): Promise<import("@bindings/Prompt").Prompt[]> {
  return invokeWithAppError<import("@bindings/Prompt").Prompt[]>(
    "list_space_prompts",
    { spaceId },
  );
}
