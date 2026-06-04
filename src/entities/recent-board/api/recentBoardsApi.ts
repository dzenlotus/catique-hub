/**
 * Recent boards IPC client (refactor-v3 D-F).
 *
 * Backs the AppSidebar's "Recent" LRU section. The Rust side persists
 * the list in `recent_boards(board_id PK FK boards, visited_at)` with
 * ON DELETE CASCADE; eviction-to-five runs inside `track_board_visit`
 * itself so the table never grows past five rows.
 *
 * The list endpoint joins against `boards` and orders by `visited_at`
 * DESC so the sidebar consumer doesn't have to look up names + icons
 * separately.
 */

import { invokeWithAppError } from "@shared/api";
import type { Board } from "@bindings/Board";

/**
 * `list_recent_boards` — up to 5 most-recently-visited boards, joined
 * with `boards`, ordered by `visited_at` DESC.
 */
export async function listRecentBoards(): Promise<Board[]> {
  return invokeWithAppError<Board[]>("list_recent_boards");
}

/**
 * `track_board_visit` — UPSERT a board into the LRU and prune anything
 * past the top-5 by recency. Fire-and-forget from board-open in the UI.
 * Throws `notFound` when the board doesn't exist.
 */
export async function trackBoardVisit(boardId: string): Promise<void> {
  return invokeWithAppError<void>("track_board_visit", { boardId });
}

/**
 * `clear_recent_boards` — wipe every row from `recent_boards`. Backs
 * the AppSidebar's "Clear" affordance — explicit user intent, so no
 * soft-delete. Pinned boards live in a sibling table and are untouched.
 * Idempotent: clearing an already-empty table is a silent no-op.
 */
export async function clearRecentBoards(): Promise<void> {
  return invokeWithAppError<void>("clear_recent_boards");
}
