/**
 * `usePromptTagFilter` — React binding over the prompt tag-filter store.
 *
 * Returns the currently-selected tag ids plus a stable setter. Both the
 * header filter control (`TopBar`) and the prompts list consumers
 * (`PromptsSidebar` / `PromptsPage`) call this hook so they share one
 * selection without prop-drilling through the layout shell.
 */
import { useCallback, useSyncExternalStore } from "react";

import {
  clearPromptTagFilter,
  readPromptTagFilter,
  setPromptTagFilter,
  subscribePromptTagFilter,
} from "./promptTagFilterStore";

export interface UsePromptTagFilterResult {
  /** Selected tag ids, in selection order. Stable reference while unchanged. */
  selectedTagIds: ReadonlyArray<string>;
  /** Replace the full selection. */
  setSelectedTagIds: (next: ReadonlyArray<string>) => void;
  /** Clear all selected tags. */
  clear: () => void;
}

export function usePromptTagFilter(): UsePromptTagFilterResult {
  const selectedTagIds = useSyncExternalStore(
    subscribePromptTagFilter,
    readPromptTagFilter,
    readPromptTagFilter,
  );

  const setSelectedTagIds = useCallback((next: ReadonlyArray<string>) => {
    setPromptTagFilter(next);
  }, []);

  const clear = useCallback(() => {
    clearPromptTagFilter();
  }, []);

  return { selectedTagIds, setSelectedTagIds, clear };
}
