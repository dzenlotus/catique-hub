/**
 * PromptsTagFilterPopover — sidebar tag-filter affordance.
 *
 * A compact filter button rendered in the PROMPTS section header. Pressing
 * it opens a popover that hosts the canonical `<PromptsTagFilter>` MultiSelect.
 * The selection is shared through the `usePromptTagFilter` store, so the
 * prompts list (`PromptsSidebar` / `PromptsPage`) reacts without prop drilling.
 *
 * Replaces the previous TopBar-hosted filter — the original sidebar-filter
 * affordance restored next to the section's "Add prompt" trigger.
 */

import { type ReactElement } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";

import { PromptsTagFilter } from "@features/prompt-tags/filter";
import { cn, usePromptTagFilter } from "@shared/lib";
import { PixelInterfaceEssentialFilter } from "@shared/ui/Icon";

import styles from "./PromptsTagFilterPopover.module.css";

export function PromptsTagFilterPopover(): ReactElement {
  const { selectedTagIds, setSelectedTagIds } = usePromptTagFilter();
  const isActive = selectedTagIds.length > 0;

  return (
    <AriaDialogTrigger>
      <AriaButton
        className={cn(styles.trigger, isActive && styles.triggerActive)}
        aria-label={
          isActive
            ? `Filter prompts by tag (${selectedTagIds.length} active)`
            : "Filter prompts by tag"
        }
        data-testid="prompts-sidebar-tags-filter-trigger"
        data-active={isActive ? "true" : undefined}
      >
        <PixelInterfaceEssentialFilter
          width={12}
          height={12}
          aria-hidden={true}
        />
        {isActive ? (
          <span className={styles.count} aria-hidden="true">
            {selectedTagIds.length}
          </span>
        ) : null}
      </AriaButton>

      <AriaPopover className={styles.popover} placement="bottom end">
        <AriaDialog
          className={styles.dialog}
          aria-label="Filter prompts by tag"
          data-testid="prompts-sidebar-tags-filter-popover"
        >
          <PromptsTagFilter
            selectedTagIds={selectedTagIds}
            onChange={setSelectedTagIds}
          />
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}
