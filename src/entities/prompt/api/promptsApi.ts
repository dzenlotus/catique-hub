/**
 * Prompts IPC client.
 *
 * Wraps Tauri `invoke` calls for the `Prompt` aggregate. Mirrors the
 * convention established in `entities/board/api/boardsApi.ts` and
 * `entities/column/api/columnsApi.ts`:
 *   - camelCase argument keys on the JS side; Tauri serialises to
 *     snake_case for the Rust handler.
 *   - `AppErrorInstance` is imported from `@entities/board` (not redefined
 *     here), but `isAppErrorShape` and `invokeWithAppError` are defined
 *     locally per the convention set in columnsApi.ts.
 *   - `Option<Option<String>>` fields (clear-to-NULL) use `?: string | null`
 *     with explicit `null` meaning "clear the field".
 */

import { invokeWithAppError } from "@shared/api";
import type { Prompt } from "@bindings/Prompt";
import type { PromptTagMapEntry } from "@bindings/PromptTagMapEntry";

/** `list_prompts` — return every prompt, ordered by `createdAt` (server-side). */
export async function listPrompts(): Promise<Prompt[]> {
  return invokeWithAppError<Prompt[]>("list_prompts");
}

/** `get_prompt` — fetch a single prompt by id. Throws AppError `notFound` if unknown. */
export async function getPrompt(id: string): Promise<Prompt> {
  return invokeWithAppError<Prompt>("get_prompt", { id });
}

export interface CreatePromptArgs {
  name: string;
  content: string;
  /** Optional accent color as a CSS hex/named string. */
  color?: string;
  /** Optional one-liner shown below the title. */
  shortDescription?: string;
  /** Optional Pixel-icon identifier (matches a key from `@shared/ui/Icon`). */
  icon?: string;
  /**
   * Optional ordered list of worked examples. Each example renders as
   * an `<example>` child of the prompt's XML envelope at task-build
   * time. Defaults to empty.
   */
  examples?: string[];
}

/** `create_prompt` — create a new prompt. */
export async function createPrompt(args: CreatePromptArgs): Promise<Prompt> {
  const payload: Record<string, unknown> = {
    name: args.name,
    content: args.content,
  };
  if (args.color !== undefined) payload.color = args.color;
  if (args.shortDescription !== undefined)
    payload.shortDescription = args.shortDescription;
  if (args.icon !== undefined) payload.icon = args.icon;
  if (args.examples !== undefined) payload.examples = args.examples;
  return invokeWithAppError<Prompt>("create_prompt", payload);
}

export interface UpdatePromptArgs {
  id: string;
  /** Skip = `undefined`, set = string. */
  name?: string;
  /** Skip = `undefined`, set = string. */
  content?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`. Mirrors
   * `Option<Option<String>>` on the Rust side.
   */
  color?: string | null;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`. Mirrors
   * `Option<Option<String>>` on the Rust side.
   */
  shortDescription?: string | null;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`. Mirrors
   * `Option<Option<String>>` on the Rust side.
   */
  icon?: string | null;
  /**
   * Skip = `undefined`, set = array (empty array clears all examples).
   * Mirrors `Option<Vec<String>>` on the Rust side — examples is
   * "list, possibly empty", not nullable.
   */
  examples?: string[];
}

/** `update_prompt` — partial update. Only provided fields are changed. */
export async function updatePrompt(args: UpdatePromptArgs): Promise<Prompt> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.content !== undefined) payload.content = args.content;
  if (args.color !== undefined) payload.color = args.color;
  if (args.shortDescription !== undefined)
    payload.shortDescription = args.shortDescription;
  if (args.icon !== undefined) payload.icon = args.icon;
  if (args.examples !== undefined) payload.examples = args.examples;
  return invokeWithAppError<Prompt>("update_prompt", payload);
}

/** `delete_prompt` — permanently remove a prompt. */
export async function deletePrompt(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_prompt", { id });
}

/**
 * `list_prompt_tags_map` — bulk fetch of every `(promptId, tagIds[])` entry
 * from the `prompt_tags` join table.  One IPC call; the caller does the
 * client-side filtering.
 */
export async function listPromptTagsMap(): Promise<PromptTagMapEntry[]> {
  return invokeWithAppError<PromptTagMapEntry[]>("list_prompt_tags_map");
}

/**
 * `recompute_prompt_token_count` — ask the backend to recount tokens for a
 * prompt using the coarse `(chars + 3) / 4` heuristic, persist the result,
 * and return the updated `Prompt`.
 *
 * The backend emits `prompt.updated` after the write so any listener
 * relying on Tauri events will also invalidate without an extra round-trip.
 *
 * Throws `AppError` (`notFound`) when the prompt id is unknown.
 */
export async function recomputePromptTokenCount(id: string): Promise<Prompt> {
  return invokeWithAppError<Prompt>("recompute_prompt_token_count", { id });
}
