import { type ReactElement } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Popover,
} from "react-aria-components";

import { cn } from "@shared/lib";
import { useTags } from "@entities/tag";
import { PixelInterfaceEssentialFilter } from "@shared/ui/Icon";

import styles from "./TagsFilterButton.module.css";

export interface TagsFilterButtonProps {
  selectedTagIds: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}

/**
 * Filter trigger anchored to the right of the PROMPTS section label.
 * Opens a popover with a multi-select list of tag chips. The trigger
 * highlights when any tag is selected so the active filter is visible
 * even when the popover is closed.
 */
export function TagsFilterButton({
  selectedTagIds,
  onChange,
}: TagsFilterButtonProps): ReactElement {
  const tagsQuery = useTags();
  const tags = tagsQuery.data ?? [];
  const isActive = selectedTagIds.length > 0;

  const toggleTag = (tagId: string): void => {
    if (selectedTagIds.includes(tagId)) {
      onChange(selectedTagIds.filter((id) => id !== tagId));
    } else {
      onChange([...selectedTagIds, tagId]);
    }
  };

  const clear = (): void => {
    onChange([]);
  };

  return (
    <DialogTrigger>
      <AriaButton
        className={cn(styles.trigger, isActive && styles.triggerActive)}
        aria-label={
          isActive
            ? `Filter by tags (${selectedTagIds.length} active)`
            : "Filter by tags"
        }
        data-testid="prompts-sidebar-tags-filter-trigger"
      >
        <PixelInterfaceEssentialFilter
          width={12}
          height={12}
          aria-hidden={true}
        />
      </AriaButton>
      <Popover className={styles.popover} placement="bottom end">
        <AriaDialog
          className={styles.dialog}
          aria-label="Filter prompts by tags"
        >
          <div className={styles.header}>
            <span className={styles.headerLabel}>Filter by tags</span>
            {isActive ? (
              <button
                type="button"
                className={styles.clearBtn}
                onClick={clear}
                data-testid="prompts-sidebar-tags-filter-clear"
              >
                Clear
              </button>
            ) : null}
          </div>

          {tagsQuery.status === "pending" ? (
            <div className={styles.empty}>Loading tags…</div>
          ) : tags.length === 0 ? (
            <div className={styles.empty}>No tags yet.</div>
          ) : (
            <ul className={styles.tagList} role="list">
              {tags.map((tag) => {
                const checked = selectedTagIds.includes(tag.id);
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      className={cn(
                        styles.tagRow,
                        checked && styles.tagRowChecked,
                      )}
                      onClick={() => toggleTag(tag.id)}
                      aria-pressed={checked}
                      data-testid={`prompts-sidebar-tags-filter-tag-${tag.id}`}
                    >
                      <span
                        className={styles.tagSwatch}
                        style={
                          tag.color !== null
                            ? { backgroundColor: tag.color }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                      <span className={styles.tagName}>{tag.name}</span>
                      {checked ? (
                        <span className={styles.tagCheck} aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}
