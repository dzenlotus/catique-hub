/**
 * Recent boards — legacy localStorage reader.
 *
 * Refactor-v3 D-F (2026-05) moved the source of truth to SQLite via
 * `@entities/recent-board`. This module survives so the one-shot
 * `MigrateLegacyPrefsProvider` can pull the user's prior recents out
 * of localStorage on the first boot after upgrade, push them to the
 * backend in order (newest first), and clear the slot.
 */
import { jsonCodec } from "./codecs";
import { LocalStorageStore } from "./LocalStorageStore";

/** Slot name kept stable so existing installs migrate cleanly. */
export const LEGACY_RECENT_KEY = "catique:recentBoards";

interface RecentBoardsState {
  boardIds: string[];
}

const store = new LocalStorageStore<RecentBoardsState>({
  key: LEGACY_RECENT_KEY,
  codec: jsonCodec<RecentBoardsState>(),
});

/**
 * Read the legacy localStorage payload. Returns `[]` when the slot is
 * absent OR the payload is malformed — never throws. Order is
 * newest-first, matching the prior `trackBoardVisit` write convention.
 */
export function readLegacyRecentBoards(): ReadonlyArray<string> {
  const state = store.get();
  if (state === null) return [];
  return state.boardIds.filter((id) => typeof id === "string");
}

/** Drop the legacy slot. Idempotent. */
export function clearLegacyRecentBoards(): void {
  store.remove();
}
