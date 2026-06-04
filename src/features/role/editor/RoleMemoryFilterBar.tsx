/**
 * RoleMemoryFilterBar — tag chips + search box + sort dropdown for
 * `RoleMemorySection` (ctq-137 / MEM-S2).
 *
 * Pure presentation: the orchestrating section owns the state via
 * `useRoleNoteFilters` and passes the relevant slice down.
 */

import type { ReactElement } from "react";

import { Button, Input } from "@shared/ui";

import type { RoleNoteSort } from "./useRoleNoteFilters";
import type { RoleNoteTagCount } from "@entities/role-note";
import styles from "./RoleMemorySection.module.css";

const SORT_OPTIONS: Array<{ value: RoleNoteSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "highestPriority", label: "Highest priority" },
  { value: "mostRecentUpdate", label: "Most recent" },
  { value: "oldest", label: "Oldest first" },
];

export interface RoleMemoryFilterBarProps {
  tagCounts: readonly RoleNoteTagCount[];
  selectedTags: ReadonlySet<string>;
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  searchInput: string;
  onSearchChange: (next: string) => void;
  sort: RoleNoteSort;
  onSortChange: (next: RoleNoteSort) => void;
}

export function RoleMemoryFilterBar({
  tagCounts,
  selectedTags,
  onToggleTag,
  onClearTags,
  searchInput,
  onSearchChange,
  sort,
  onSortChange,
}: RoleMemoryFilterBarProps): ReactElement {
  return (
    <div
      className={styles.filters}
      data-testid="role-memory-section-filters"
    >
      {tagCounts.length > 0 ? (
        <div
          className={styles.tagChips}
          role="group"
          aria-label="Filter notes by tag"
        >
          {tagCounts.map((tc) => {
            const active = selectedTags.has(tc.tag);
            return (
              <button
                key={tc.tag}
                type="button"
                className={styles.tagChip}
                aria-pressed={active}
                onClick={() => onToggleTag(tc.tag)}
                data-testid={`role-memory-section-tag-chip-${tc.tag}`}
              >
                {tc.tag}
                <span className={styles.tagChipCount}>({tc.count})</span>
              </button>
            );
          })}
          {selectedTags.size > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={onClearTags}
              data-testid="role-memory-section-tag-clear"
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.filterRow}>
        <Input
          type="search"
          label="Search notes"
          labelHidden
          className={styles.searchField}
          value={searchInput}
          onChange={onSearchChange}
          placeholder="Search note bodies…"
          data-testid="role-memory-section-search"
        />
        <select
          className={styles.sortSelect}
          value={sort}
          onChange={(e) => onSortChange(e.target.value as RoleNoteSort)}
          aria-label="Sort notes"
          data-testid="role-memory-section-sort"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
