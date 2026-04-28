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

/** Arguments for the blob-aware upload IPC. */
export interface UploadAttachmentArgs {
  taskId: string;
  sourcePath: string;
  originalFilename: string;
  mimeType?: string | null;
}

/**
 * `upload_attachment` — copy a local file into the task attachment
 * directory and create the metadata row in one atomic step.
 *
 * The Rust handler resolves the target directory, copies the blob,
 * infers MIME type when `mimeType` is null, inserts the row, and emits
 * `attachment.created` — all server-side.
 */
export async function uploadAttachment(
  args: UploadAttachmentArgs,
): Promise<Attachment> {
  return invokeWithAppError<Attachment>("upload_attachment", {
    taskId: args.taskId,
    sourcePath: args.sourcePath,
    originalFilename: args.originalFilename,
    mimeType: args.mimeType ?? null,
  });
}
