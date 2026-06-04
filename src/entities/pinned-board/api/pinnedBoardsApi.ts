/**
 * Pinned boards IPC client (refactor-v3 D-F).
 *
 * Backs the AppSidebar's "Pinned" section. The Rust side persists the
 * list in `pinned_boards(board_id PK FK boards, position REAL, pinned_at)`
 * with ON DELETE CASCADE so a deleted board disappears from the section
 * automatically — no application-layer fixups needed.
 *
 * The wire contract returns full `Board` rows joined against `boards`,
 * so the consumer never has to round-trip a second `getBoard()` per
 * id; the section header can render names + icons in one shot.
 */

import { invokeWithAppError } from "@shared/api";
import type { Board } from "@bindings/Board";

/** `list_pinned_boards` — returns full Board records ordered by `position` ASC. */
export async function listPinnedBoards(): Promise<Board[]> {
  return invokeWithAppError<Board[]>("list_pinned_boards");
}

/**
 * `pin_board` — append `boardId` to the pinned set. Idempotent (already
 * pinned = silent no-op). Throws `notFound` when the board doesn't exist.
 */
export async function pinBoard(boardId: string): Promise<void> {
  return invokeWithAppError<void>("pin_board", { boardId });
}

/**
 * `unpin_board` — remove `boardId` from the pinned set. Idempotent
 * (not-pinned = silent no-op).
 */
export async function unpinBoard(boardId: string): Promise<void> {
  return invokeWithAppError<void>("unpin_board", { boardId });
}

/**
 * `reorder_pinned` — set the row's `position` REAL value. The caller
 * picks the fractional midpoint between the two neighbours it wants the
 * row to land between (same convention as `boards.position`). Throws
 * `notFound` when the board is not currently pinned.
 */
export async function reorderPinned(
  boardId: string,
  newPosition: number,
): Promise<void> {
  return invokeWithAppError<void>("reorder_pinned", {
    boardId,
    newPosition,
  });
}
