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
 * `pinnedBoards` + `recentBoards` localStorage shims are deprecated as
 * of refactor-v3 D-F — the source of truth is now SQLite via the
 * `@entities/pinned-board` and `@entities/recent-board` slices. The
 * legacy reader exports are kept only inside `./pinnedBoardsLegacy`
 * and `./recentBoardsLegacy` for the one-shot migration helper that
 * boots the app (see `app/providers/MigrateLegacyPrefsProvider`).
 *
 * Public consumers (SpacesSidebar, KanbanBoard) MUST use the entity
 * mutations / the wrapped `usePinnedBoards` / `useRecentBoards` hooks
 * below — never the local read helpers.
 */
export {
  readLegacyPinnedBoards,
  clearLegacyPinnedBoards,
} from "./pinnedBoardsLegacy";

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
  usePinnedBoards,
  useRecentBoards,
  useSidebarCollapsed,
} from "./usePinnedRecent";
