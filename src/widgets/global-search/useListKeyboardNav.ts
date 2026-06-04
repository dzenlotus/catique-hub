/**
 * `useListKeyboardNav` — arrow / enter keyboard navigation over a flat
 * ordered list, decoupled from what the list renders.
 *
 * The palette drives `focusedIndex` (the highlighted row) and asks this
 * hook to translate Arrow Up / Down / Enter key events into index moves
 * and an `onActivate(index, event)` callback. Esc is intentionally NOT
 * handled here — RAC's `ModalOverlay isDismissable` owns dismissal.
 *
 * The hook is purposely state-light: it owns `focusedIndex` and exposes
 * a setter so hover handlers can sync focus, plus a `reset()` for when
 * the underlying list changes identity (new query, mode switch).
 */
import {
  useCallback,
  useState,
  type KeyboardEvent,
} from "react";

export interface UseListKeyboardNavResult {
  /** Index of the currently-highlighted row, or -1 when none. */
  focusedIndex: number;
  /** Imperatively move focus (used by row hover handlers). */
  setFocusedIndex: (index: number) => void;
  /** Clear focus back to -1. */
  reset: () => void;
  /**
   * Keydown handler for the list wrapper. Translates Arrow Up/Down into
   * focus moves and Enter into an `onActivate(index, event)` call when a
   * row is focused.
   */
  handleKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export function useListKeyboardNav(
  itemCount: number,
  onActivate: (index: number, e: KeyboardEvent<HTMLElement>) => void,
): UseListKeyboardNavResult {
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const reset = useCallback(() => setFocusedIndex(-1), []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>): void => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          itemCount === 0 ? -1 : Math.min(prev + 1, itemCount - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        if (focusedIndex >= 0 && focusedIndex < itemCount) {
          onActivate(focusedIndex, e);
        }
      }
      // Esc is handled by RAC ModalOverlay (isDismissable).
    },
    [itemCount, focusedIndex, onActivate],
  );

  return { focusedIndex, setFocusedIndex, reset, handleKeyDown };
}
