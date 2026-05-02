/**
 * Per-space "last opened board" pointer.
 *
 * `BoardHome` reads it once on mount to decide whether to redirect to a
 * remembered kanban view, and `KanbanBoard` writes to it whenever a board
 * is opened. Both consumers import the single function from
 * `@shared/storage` so the key + codec stay in lock-step.
 *
 * Round-19c relocation (audit F-12): previously lived in
 * `@widgets/board-home`, which made KanbanBoard cross-widget-import its
 * sibling — an FSD smell. Moved here alongside the other storage
 * primitives.
 */

import { LocalStorageStore } from "./LocalStorageStore";
import { stringCodec } from "./codecs";

/** localStorage key shape. Exposed for tests + diagnostics. */
export function lastBoardKey(spaceId: string): string {
  return `catique:lastBoardId:${spaceId}`;
}

/**
 * Build a `LocalStorageStore<string>` for the given space's last-opened
 * board id. The store is cheap to instantiate — callers may construct it
 * on demand inside an effect.
 */
export function lastBoardStore(spaceId: string): LocalStorageStore<string> {
  return new LocalStorageStore<string>({
    key: lastBoardKey(spaceId),
    codec: stringCodec,
  });
}
