/**
 * MigrateLegacyPrefsProvider — refactor-v3 D-F one-shot migration.
 *
 * Before D-F the Pinned and Recent board lists lived in localStorage
 * (`catique:pinnedBoards`, `catique:recentBoards`). D-F moved them to
 * dedicated SQLite tables. To preserve user state across the upgrade
 * we run a single best-effort migration on app boot:
 *
 *   1. Read both legacy slots out of localStorage.
 *   2. Push each id to the new IPC (`pin_board`, `track_board_visit`).
 *      Recent ids are pushed OLDEST → NEWEST so the server-side
 *      `visited_at` timestamps land in the right order (the LRU
 *      pruner keeps the top-5 by recency).
 *   3. Clear the legacy slots so the migration doesn't run twice.
 *
 * Every backend call is wrapped in try/catch so a single failure
 * (e.g. the board was deleted in the interim → `notFound`) doesn't
 * abort the rest of the batch — and the whole migration is wrapped
 * once more so an unexpected exception can't block the rest of the
 * app from booting.
 *
 * The provider is invisible (no DOM); it runs the migration on mount
 * and immediately renders its children. It must sit INSIDE
 * `QueryProvider` so the entity mutations the migration triggers
 * (post-D-F) would invalidate the right caches on success — but the
 * present implementation calls `invoke` directly because it has to
 * fire-and-forget, not block boot waiting for the cache to refresh.
 */

import { useEffect, type PropsWithChildren, type ReactElement } from "react";

import { invoke } from "@shared/api";
import {
  clearLegacyPinnedBoards,
  clearLegacyRecentBoards,
  readLegacyPinnedBoards,
  readLegacyRecentBoards,
} from "@shared/storage";

async function migrate(): Promise<void> {
  const legacyPinned = readLegacyPinnedBoards();
  const legacyRecent = readLegacyRecentBoards();

  // No legacy data — nothing to do, and we still want to drop the
  // slots so a stale `{"boardIds":[]}` payload doesn't linger.
  if (legacyPinned.length === 0 && legacyRecent.length === 0) {
    clearLegacyPinnedBoards();
    clearLegacyRecentBoards();
    return;
  }

  // Pinned: push in stored order so positions track the user's prior
  // arrangement. Each `pin_board` server-side stamps
  // `MAX(position) + 1`, which preserves the order naturally.
  for (const id of legacyPinned) {
    try {
      await invoke("pin_board", { boardId: id });
    } catch (err) {
      // Most likely `notFound` — the board was deleted while still
      // referenced in the legacy slot. Skip and continue.
      console.warn(`[catique-hub] migrate pin_board(${id}) skipped:`, err);
    }
  }

  // Recent: legacy order is newest-first. Push OLDEST → NEWEST so the
  // server's `visited_at` timestamps reflect the original recency.
  for (const id of [...legacyRecent].reverse()) {
    try {
      await invoke("track_board_visit", { boardId: id });
    } catch (err) {
      console.warn(
        `[catique-hub] migrate track_board_visit(${id}) skipped:`,
        err,
      );
    }
  }

  // Clear only after the writes returned — keeps the slot available
  // for a retry if the IPC layer was momentarily unreachable.
  clearLegacyPinnedBoards();
  clearLegacyRecentBoards();
}

export function MigrateLegacyPrefsProvider({
  children,
}: PropsWithChildren): ReactElement {
  useEffect(() => {
    // Fire-and-forget — render children immediately so the migration
    // doesn't block first paint. Wrapped in `void` + try/catch via
    // `.catch` because the React effect signature doesn't allow async.
    migrate().catch((err) => {
      console.warn("[catique-hub] legacy prefs migration failed:", err);
    });
  }, []);

  return <>{children}</>;
}
