import { type ReactElement } from "react";
import { useSortable } from "@dnd-kit/react/sortable";

import { cn } from "@shared/lib";
import { IconRenderer, MarqueeText } from "@shared/ui";
import type { Prompt } from "@entities/prompt";

import styles from "./PromptsSidebar.module.css";

// ---------------------------------------------------------------------------
// PromptRow — single draggable prompt entry in the bottom section.
// ---------------------------------------------------------------------------

/**
 * Layout discipline (mirrors `KanbanColumn.SortableTask`):
 *  - The row body is a `<button>` so the user can activate it with
 *    Enter/Space to open the editor.
 *  - The drag handle is a separate `<button>` wired to `handleRef`, so
 *    only that affordance starts a drag (the body remains keyboard-
 *    activatable without dragging).
 *  - `group` here is the @dnd-kit group identifier — i.e. which group
 *    the prompt currently belongs to. The dnd-kit "group" overload
 *    with a `Record<UniqueIdentifier, Items>` shape lets `move()`
 *    reorder both within and across groups in one call.
 */
export interface PromptRowProps {
  prompt: Prompt;
  index: number;
  /** dnd-kit group identifier — the owning group's id (or "ungrouped"). */
  groupId: string;
  isActive: boolean;
  onSelect: (id: string) => void;
}

export function PromptRow({
  prompt,
  index,
  groupId,
  isActive,
  onSelect,
}: PromptRowProps): ReactElement {
  const { ref, handleRef, isDragging } = useSortable({
    id: prompt.id,
    index,
    group: groupId,
    type: "prompt",
    accept: ["prompt"],
  });

  return (
    <li
      ref={(element) => ref(element)}
      className={cn(
        styles.promptItem,
        styles.promptRow,
        isActive && styles.promptRowActive,
        isDragging && styles.promptDragging,
      )}
      data-testid={`prompts-sidebar-prompt-row-${prompt.id}`}
    >
      {isActive && (
        <span className={styles.promptActiveStrip} aria-hidden="true" />
      )}
      <button
        type="button"
        ref={(element) => handleRef(element)}
        className={styles.promptDragHandle}
        aria-label={`Drag prompt ${prompt.name}`}
        data-testid={`prompts-sidebar-prompt-handle-${prompt.id}`}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <span className={styles.promptIndicator} aria-hidden="true">
        {prompt.icon !== null ? (
          <IconRenderer
            name={prompt.icon}
            width={14}
            height={14}
            className={styles.promptIcon}
            {...(prompt.color !== null
              ? { style: { color: prompt.color } }
              : {})}
          />
        ) : prompt.color !== null ? (
          <span
            className={styles.promptSwatch}
            style={{ backgroundColor: prompt.color }}
          />
        ) : null}
      </span>
      <button
        type="button"
        className={styles.promptName}
        onClick={() => onSelect(prompt.id)}
        aria-current={isActive ? "page" : undefined}
        aria-label={prompt.name}
        data-testid={`prompts-sidebar-prompt-select-${prompt.id}`}
      >
        <MarqueeText text={prompt.name} />
      </button>
    </li>
  );
}
