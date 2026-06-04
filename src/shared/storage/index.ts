/**
 * Public API of `@shared/storage`.
 *
 * The only entry point app code should use to read/write `localStorage`.
 * Direct `window.localStorage.*` calls outside `LocalStorageStore.ts`
 * are forbidden in production code (see CI grep guard).
 */

export { KeyValueStore } from "./KeyValueStore";
export type { StoreListener } from "./KeyValueStore";

export { LocalStorageStore } from "./LocalStorageStore";

export { stringCodec, booleanCodec, jsonCodec } from "./codecs";
export type { Codec } from "./codecs";

export { useLocalStorage } from "./useLocalStorage";
export type { SetStorageValue } from "./useLocalStorage";

export { lastBoardKey, lastBoardStore } from "./lastBoardStore";

/**
 * `recentBoards` localStorage shim is deprecated as of refactor-v3 D-F —
 * the source of truth is now SQLite via the `@entities/recent-board`
 * slice. The legacy reader exports are kept only inside
 * `./recentBoardsLegacy` for the one-shot migration helper that boots
 * the app (see `app/providers/MigrateLegacyPrefsProvider`).
 *
 * Public consumers (KanbanBoard) MUST use the entity mutations / the
 * wrapped `useRecentBoards` hook below — never the local read helpers.
 */
export {
  readLegacyRecentBoards,
  clearLegacyRecentBoards,
} from "./recentBoardsLegacy";

export {
  readSidebarCollapsed,
  writeSidebarCollapsed,
  subscribeSidebarCollapsed,
  readLastActiveSpaceId,
  writeLastActiveSpaceId,
} from "./appShellPrefs";

export {
  useRecentBoards,
  useSidebarCollapsed,
} from "./usePinnedRecent";
