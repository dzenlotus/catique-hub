/**
 * Tags IPC client.
 *
 * Wraps Tauri `invoke` calls for the `Tag` aggregate. Mirrors the
 * convention established in `entities/column/api/columnsApi.ts`:
 *   - camelCase argument keys on the JS side; Tauri serialises to
 *     snake_case for the Rust handler.
 *   - AppError-shaped rejections are remapped to `AppErrorInstance` so
 *     consumers can narrow on `.error.kind`.
 *
 * Note: the Rust `Tag` struct has no `kind` field — the binding
 * (`bindings/Tag.ts`) confirms: id, name, color, createdAt, updatedAt
 * only. The task brief's `kind` references were speculative; we match
 * reality.
 */

import { invoke } from "@shared/api";
import { AppErrorInstance } from "@entities/board";
import type { AppError } from "@bindings/AppError";
import type { Tag } from "@bindings/Tag";

/** Same `AppError` discriminator used in `boardsApi` and `columnsApi`. */
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

/** `list_tags` — fetch every tag. */
export async function listTags(): Promise<Tag[]> {
  return invokeWithAppError<Tag[]>("list_tags");
}

/** `get_tag` — fetch a single tag by id. */
export async function getTag(id: string): Promise<Tag> {
  return invokeWithAppError<Tag>("get_tag", { id });
}

export interface CreateTagArgs {
  name: string;
  /** Optional hex/named colour associated with this tag. */
  color?: string;
}

/** `create_tag` — create a new tag. */
export async function createTag(args: CreateTagArgs): Promise<Tag> {
  const payload: Record<string, unknown> = { name: args.name };
  if (args.color !== undefined) payload.color = args.color;
  return invokeWithAppError<Tag>("create_tag", payload);
}

export interface UpdateTagArgs {
  id: string;
  /** Skip = `undefined`, set = string. */
  name?: string;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`. Mirrors
   * the Rust `Option<Option<String>>` shape.
   */
  color?: string | null;
}

/** `update_tag` — partial update. */
export async function updateTag(args: UpdateTagArgs): Promise<Tag> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.color !== undefined) payload.color = args.color;
  return invokeWithAppError<Tag>("update_tag", payload);
}

/** `delete_tag` — remove a tag. */
export async function deleteTag(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_tag", { id });
}

// ---------------------------------------------------------------------
// Join-table helpers — prompt_tags.
// ---------------------------------------------------------------------

export interface PromptTagArgs {
  promptId: string;
  tagId: string;
}

/** `add_prompt_tag` — attach a tag to a prompt. */
export async function addPromptTag(args: PromptTagArgs): Promise<void> {
  return invokeWithAppError<void>("add_prompt_tag", {
    promptId: args.promptId,
    tagId: args.tagId,
  });
}

/** `remove_prompt_tag` — detach a tag from a prompt. */
export async function removePromptTag(args: PromptTagArgs): Promise<void> {
  return invokeWithAppError<void>("remove_prompt_tag", {
    promptId: args.promptId,
    tagId: args.tagId,
  });
}
