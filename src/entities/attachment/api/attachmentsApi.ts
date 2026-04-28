/**
 * Attachments IPC client.
 *
 * Wraps Tauri `invoke` calls for the `Attachment` aggregate. Argument
 * shape follows the contract the Rust side accepts: keys are camelCase
 * on the JS side (Tauri auto-converts to snake_case for Rust per the
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
import type { Attachment } from "@bindings/Attachment";

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

/** `list_attachments` — return every attachment metadata row. */
export async function listAttachments(): Promise<Attachment[]> {
  return invokeWithAppError<Attachment[]>("list_attachments");
}

/** `get_attachment` — fetch a single attachment by id. */
export async function getAttachment(id: string): Promise<Attachment> {
  return invokeWithAppError<Attachment>("get_attachment", { id });
}

/** `delete_attachment` — remove an attachment metadata row. */
export async function deleteAttachment(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_attachment", { id });
}

// TODO(E5): wire up blob-aware upload — `createAttachment` requires
// that the caller has already persisted the blob under
// `<app_data>/attachments/<task_id>/` before calling the IPC.
// Exposing a metadata-only wrapper here before blob upload exists in
// the UI would be footgun-prone; defer until the file-picker flow lands.
