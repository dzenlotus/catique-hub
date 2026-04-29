/**
 * PromptsTagFilter — horizontal chip row for filtering prompts by tag.
 *
 * Renders an "All" chip followed by one chip per tag returned by
 * `useTags()`. The selected chip receives an accent treatment.
 *
 * Controlled component — the parent holds `selectedTagId` state and
 * passes `onChange` to update it.
 */

import type { ReactElement } from "react";

import { useTags } from "@entities/tag";
import { cn } from "@shared/lib";

import styles from "./PromptsTagFilter.module.css";

export interface PromptsTagFilterProps {
  /** Currently active tag id, or `null` meaning "show all". */
  selectedTagId: string | null;
  /** Called with the new tag id, or `null` to clear the filter. */
  onChange: (tagId: string | null) => void;
}

/**
 * `PromptsTagFilter` — controlled filter chip row.
 *
 * Async-UI:
 *   - pending: renders only the "All" chip (tags not yet loaded).
 *   - error / empty tags: renders only the "All" chip (filter not useful).
 *   - populated: "All" chip + one chip per tag.
 */
export function PromptsTagFilter({
  selectedTagId,
  onChange,
}: PromptsTagFilterProps): ReactElement {
  const tagsQuery = useTags();

  const tags = tagsQuery.data ?? [];

  return (
    <div
      className={styles.root}
      role="group"
      aria-label="Filter prompts by tag"
      data-testid="prompts-tag-filter"
    >
      {/* "All" chip — always visible */}
      <button
        type="button"
        className={cn(
          styles.chip,
          selectedTagId === null && styles.chipSelected,
        )}
        onClick={() => onChange(null)}
        aria-pressed={selectedTagId === null}
        data-testid="prompts-tag-filter-all"
      >
        All
      </button>

      {/* Per-tag chips */}
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className={cn(
            styles.chip,
            selectedTagId === tag.id && styles.chipSelected,
          )}
          onClick={() => onChange(selectedTagId === tag.id ? null : tag.id)}
          aria-pressed={selectedTagId === tag.id}
          data-testid={`prompts-tag-filter-chip-${tag.id}`}
        >
          {tag.color !== null ? (
            <span
              className={styles.swatch}
              style={{ backgroundColor: tag.color }}
              aria-hidden="true"
            />
          ) : null}
          {tag.name}
        </button>
      ))}
    </div>
  );
}
