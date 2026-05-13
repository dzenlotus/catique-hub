/**
 * useRoleNoteFilters — local-state filter/sort hook for the
 * `RoleMemorySection` (ctq-137).
 *
 * Lifts the filter, search, and sort state out of the rendering
 * component so the section file stays small and the logic is testable
 * in isolation. The hook is pure-by-derivation: every output is a
 * `useMemo` over the same primitives, so re-renders cost an array
 * walk only.
 *
 * The search input is debounced 250 ms — typing into a long list
 * shouldn't refilter on every keystroke.
 */

import { useEffect, useMemo, useState } from "react";

import type { RoleNote } from "@entities/role-note";

export type RoleNoteSort =
  | "newest"
  | "highestPriority"
  | "mostRecentUpdate"
  | "oldest";

export interface UseRoleNoteFiltersResult {
  /** Active tag filter (multi-select union — note must include ≥1). */
  selectedTags: ReadonlySet<string>;
  toggleTag: (tag: string) => void;
  clearTags: () => void;
  /** Raw search query — caller binds this to the `<input>`. */
  searchInput: string;
  setSearchInput: (next: string) => void;
  /** Debounced version used for filtering. */
  debouncedSearch: string;
  sort: RoleNoteSort;
  setSort: (next: RoleNoteSort) => void;
  /** Filtered + sorted notes. Pinned notes are pulled to the top. */
  visibleNotes: RoleNote[];
}

const SEARCH_DEBOUNCE_MS = 250;

export function useRoleNoteFilters(
  notes: readonly RoleNote[],
): UseRoleNoteFiltersResult {
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<RoleNoteSort>("newest");

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const toggleTag = (tag: string): void => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const clearTags = (): void => setSelectedTags(new Set());

  const visibleNotes = useMemo(() => {
    const filtered = notes.filter((note) => {
      if (selectedTags.size > 0) {
        const hit = note.tags.some((t) => selectedTags.has(t));
        if (!hit) return false;
      }
      if (debouncedSearch.length > 0) {
        if (!note.body.toLowerCase().includes(debouncedSearch)) return false;
      }
      return true;
    });

    const sorted = filtered.slice().sort((a, b) => {
      // Pinned notes always sort first regardless of the secondary key.
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      switch (sort) {
        case "newest":
          return Number(b.createdAt - a.createdAt);
        case "oldest":
          return Number(a.createdAt - b.createdAt);
        case "highestPriority":
          return b.priority - a.priority;
        case "mostRecentUpdate":
          return Number(b.updatedAt - a.updatedAt);
      }
    });

    return sorted;
  }, [notes, selectedTags, debouncedSearch, sort]);

  return {
    selectedTags,
    toggleTag,
    clearTags,
    searchInput,
    setSearchInput,
    debouncedSearch,
    sort,
    setSort,
    visibleNotes,
  };
}
