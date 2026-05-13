/**
 * useEntityTreeExpandedStorage — opt-in helper that persists the
 * `expandedIds` set across reloads via `@shared/storage`.
 *
 * Why a single JSON-array key, not one boolean key per row:
 *   - `EntityTree` is a controlled component — the parent owns the full
 *     expanded set and passes it down. Reconstructing the set from N
 *     separate boolean keys would require knowing the universe of ids
 *     up-front, which the caller doesn't have at hook-call time.
 *   - A single JSON-encoded array round-trips cleanly through
 *     `useLocalStorage(jsonCodec<string[]>())` and survives cross-tab
 *     writes via the same `storage` event the rest of the app rides on.
 *
 * Usage:
 *   const { expandedIds, toggleExpand } = useEntityTreeExpandedStorage(
 *     "catique:roles-sidebar:expanded",
 *   );
 */

import { useCallback } from "react";

import { jsonCodec, useLocalStorage } from "@shared/storage";

const EMPTY: ReadonlyArray<string> = [];

export interface UseEntityTreeExpandedStorageResult {
  expandedIds: ReadonlyArray<string>;
  toggleExpand: (id: string) => void;
}

export function useEntityTreeExpandedStorage(
  storageKey: string,
): UseEntityTreeExpandedStorageResult {
  const codec = jsonCodec<string[]>();
  const [stored, setStored] = useLocalStorage<string[]>(storageKey, codec, []);

  // `stored` is `string[] | null` per the hook overload — we passed a
  // default so the value is always an array, but typescript still
  // narrows defensively. Fall through to `EMPTY` so consumers can pass
  // the result straight into `expandedIds`.
  const expandedIds = stored ?? EMPTY;

  const toggleExpand = useCallback(
    (id: string): void => {
      setStored((prev) => {
        const list = prev ?? [];
        return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      });
    },
    [setStored],
  );

  return { expandedIds, toggleExpand };
}
