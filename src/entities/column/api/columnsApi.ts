/**
 * Columns IPC client.
 *
 * Wraps Tauri `invoke` calls for the `Column` aggregate. Mirrors the
 * convention established in `entities/board/api/boardsApi.ts`:
 *   - camelCase argument keys on the JS side; Tauri serialises to
 *     snake_case for the Rust handler.
 *   - AppError-shaped rejections are remapped to `AppErrorInstance` so
 *     consumers can narrow on `.error.kind`.
 *
 * Note on `list_columns`: Olga's E2.4 handler returns every column
 * across every board (signature: `list_columns()` — no `board_id`
 * argument). Filtering by `boardId` happens client-side here. When
 * cardinality grows past ~hundreds of columns we'll push the filter
 * server-side; for now (single-user, ≤50 columns total) filtering in JS
 * is cheaper than touching the Rust API.
 *
 * TODO(coordinate-with-olga): server-side `list_columns(boardId)` —
 * preferable once column-count > ~50 per app instance.
 */

import { invoke } from "@shared/api";
import { AppErrorInstance } from "@entities/board";
import type { AppError } from "@bindings/AppError";
import type { Column } from "@bindings/Column";

/** Same `AppError` discriminator we use in `boardsApi`. */
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

/**
 * `list_columns` — fetch every column then filter by `boardId`
 * client-side. Result is ordered by `position` ascending.
 */
export async function listColumns(boardId: string): Promise<Column[]> {
  const all = await invokeWithAppError<Column[]>("list_columns");
  return all
    .filter((c) => c.boardId === boardId)
    .sort((a, b) => Number(a.position - b.position));
}

/** `get_column` — fetch a single column by id. */
export async function getColumn(id: string): Promise<Column> {
  return invokeWithAppError<Column>("get_column", { id });
}

export interface CreateColumnArgs {
  boardId: string;
  name: string;
  /**
   * Position rank. Higher = further right. Caller is responsible for
   * computing this — typically `lastColumn.position + 1`. The widget
   * layer (`widgets/kanban-board`) does that math via
   * `dragLogic.computeNewPosition`.
   */
  position: number;
}

/** `create_column` — append a column to a board. */
export async function createColumn(args: CreateColumnArgs): Promise<Column> {
  return invokeWithAppError<Column>("create_column", {
    boardId: args.boardId,
    name: args.name,
    position: args.position,
  });
}

export interface UpdateColumnArgs {
  id: string;
  /** Skip = `undefined`, set = string. */
  name?: string;
  /** Skip = `undefined`, set = number. */
  position?: number;
  /**
   * Skip = `undefined`, set = string, clear-to-NULL = `null`. Mirrors
   * Olga's `Option<Option<String>>` shape on the Rust side.
   */
  roleId?: string | null;
}

/** `update_column` — partial update. */
export async function updateColumn(args: UpdateColumnArgs): Promise<Column> {
  const payload: Record<string, unknown> = { id: args.id };
  if (args.name !== undefined) payload.name = args.name;
  if (args.position !== undefined) payload.position = args.position;
  if (args.roleId !== undefined) payload.roleId = args.roleId;
  return invokeWithAppError<Column>("update_column", payload);
}

/** `delete_column` — remove a column (Rust cascades tasks). */
export async function deleteColumn(id: string): Promise<void> {
  return invokeWithAppError<void>("delete_column", { id });
}

export interface AddColumnPromptArgs {
  columnId: string;
  promptId: string;
  position: number;
}

/**
 * `add_column_prompt` — attach a prompt to a column at the given position.
 * Throws AppError `transactionRolledBack` on FK violation.
 */
export async function addColumnPrompt(
  args: AddColumnPromptArgs,
): Promise<void> {
  return invokeWithAppError<void>("add_column_prompt", {
    columnId: args.columnId,
    promptId: args.promptId,
    position: args.position,
  });
}
