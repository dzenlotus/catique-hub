/**
 * Pinned boards — legacy localStorage reader.
 *
 * Refactor-v3 D-F (2026-05) moved the source of truth to SQLite via
 * `@entities/pinned-board`. This module survives so the one-shot
 * `MigrateLegacyPrefsProvider` can read the user's prior selection
 * out of localStorage on the first boot after upgrade, push it to the
 * backend, and clear the slot.
 *
 * The reader is intentionally minimal — no caching, no subscriptions —
 * because the only caller runs exactly once at app start.
 */
import { jsonCodec } from "./codecs";
import { LocalStorageStore } from "./LocalStorageStore";

/** Slot name kept stable so existing installs migrate cleanly. */
export const LEGACY_PINNED_KEY = "catique:pinnedBoards";

interface PinnedBoardsState {
  boardIds: string[];
}

const store = new LocalStorageStore<PinnedBoardsState>({
  key: LEGACY_PINNED_KEY,
  codec: jsonCodec<PinnedBoardsState>(),
});

/**
 * Read the legacy localStorage payload. Returns `[]` when the slot is
 * absent OR the payload is malformed — never throws.
 */
export function readLegacyPinnedBoards(): ReadonlyArray<string> {
  const state = store.get();
  if (state === null) return [];
  return state.boardIds.filter((id) => typeof id === "string");
}

/** Drop the legacy slot. Idempotent. */
export function clearLegacyPinnedBoards(): void {
  store.remove();
}
