/**
 * PromptsTagFilter — horizontal chip row for filtering prompts by tag.
 *
 * Multi-select: each tag chip toggles independently. "All" clears the
 * entire selection. A prompt passes the filter when it carries EVERY
 * selected tag (intersection semantics) — same shape used by the
 * sidebar `<TagsFilterButton>` so the two surfaces feel symmetrical.
 *
 * Controlled component — the parent holds `selectedTagIds` and passes
 * `onChange` to update it.
 */

import type { ReactElement } from "react";

import { useTags } from "@entities/tag";
import { cn } from "@shared/lib";

import styles from "./PromptsTagFilter.module.css";

export interface PromptsTagFilterProps {
  /** Currently active tag ids; empty array = "All". */
  selectedTagIds: ReadonlyArray<string>;
  /** Called with the next set; empty = clear. */
  onChange: (next: ReadonlyArray<string>) => void;
}

/**
 * `PromptsTagFilter` — controlled multi-select filter chip row.
 *
 * Async-UI:
 *   - pending: renders only the "All" chip (tags not yet loaded).
 *   - error / empty tags: renders only the "All" chip (filter not useful).
 *   - populated: "All" chip + one toggleable chip per tag.
 */
export function PromptsTagFilter({
  selectedTagIds,
  onChange,
}: PromptsTagFilterProps): ReactElement {
  const tagsQuery = useTags();
  const tags = tagsQuery.data ?? [];

  const toggle = (id: string): void => {
    if (selectedTagIds.includes(id)) {
      onChange(selectedTagIds.filter((existing) => existing !== id));
    } else {
      onChange([...selectedTagIds, id]);
    }
  };

  const isAllActive = selectedTagIds.length === 0;

  return (
    <div
      className={styles.root}
      role="group"
      aria-label="Filter prompts by tag"
      data-testid="prompts-tag-filter"
    >
      {/* "All" chip — clears the selection. */}
      <button
        type="button"
        className={cn(styles.chip, isAllActive && styles.chipSelected)}
        onClick={() => onChange([])}
        aria-pressed={isAllActive}
        data-testid="prompts-tag-filter-all"
      >
        All
      </button>

      {/* Per-tag chips — toggleable independently. */}
      {tags.map((tag) => {
        const isSelected = selectedTagIds.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            className={cn(styles.chip, isSelected && styles.chipSelected)}
            onClick={() => toggle(tag.id)}
            aria-pressed={isSelected}
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
        );
      })}
    </div>
  );
}
