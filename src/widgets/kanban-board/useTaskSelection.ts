/**
 * useTaskSelection — lightweight multi-select hook for the kanban board.
 *
 * No persistence: selection is per-session and resets on unmount.
 * The Set reference is replaced on every mutation (immutable-style) so
 * React can detect the change, but the public API always returns a
 * ReadonlySet so callers cannot mutate it directly.
 */

import { useCallback, useState } from "react";

export interface TaskSelection {
  /** Currently selected task ids. */
  selected: ReadonlySet<string>;
  /** True when at least one task is selected. */
  selectionActive: boolean;
  /** Returns true when the given id is in the selection set. */
  isSelected: (id: string) => boolean;
  /** Toggle a single id. */
  toggle: (id: string) => void;
  /** Add a list of ids to the selection (does not clear existing). */
  select: (ids: string[]) => void;
  /** Clear the selection. */
  clear: () => void;
  /**
   * Range-select: selects every id between `fromId` and `toId`
   * (inclusive) in `allIdsInOrder`. If either id is not found, only
   * `toId` is selected.
   */
  selectRange: (fromId: string, toId: string, allIdsInOrder: string[]) => void;
}

export function useTaskSelection(): TaskSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const isSelected = useCallback(
    (id: string): boolean => selected.has(id),
    [selected],
  );

  const toggle = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const select = useCallback((ids: string[]): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback((): void => {
    setSelected(new Set<string>());
  }, []);

  const selectRange = useCallback(
    (fromId: string, toId: string, allIdsInOrder: string[]): void => {
      const fromIdx = allIdsInOrder.indexOf(fromId);
      const toIdx = allIdsInOrder.indexOf(toId);

      // If either anchor is not found, just select the target.
      if (fromIdx === -1 || toIdx === -1) {
        setSelected((prev) => {
          const next = new Set(prev);
          next.add(toId);
          return next;
        });
        return;
      }

      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      const range = allIdsInOrder.slice(lo, hi + 1);

      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of range) next.add(id);
        return next;
      });
    },
    [],
  );

  return {
    selected,
    selectionActive: selected.size > 0,
    isSelected,
    toggle,
    select,
    clear,
    selectRange,
  };
}
