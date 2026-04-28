import type { ReactElement } from "react";
import { useDroppable } from "@dnd-kit/core";

import { ColumnHeader, type ColumnHeaderProps } from "@entities/column";
import { cn } from "@shared/lib";

import styles from "./PromptDropZoneColumnHeader.module.css";

export interface PromptDropZoneColumnHeaderProps
  extends Omit<ColumnHeaderProps, "className"> {
  /**
   * The column id — used as the droppable id and stored in the droppable
   * data payload so `PromptAttachmentBoundary.onDragEnd` can resolve the
   * target without consulting the DOM.
   */
  columnId: string;
  /** Optional extra class forwarded to the wrapper (not to ColumnHeader). */
  className?: string;
}

/**
 * `PromptDropZoneColumnHeader` — wraps `ColumnHeader` with dnd-kit droppable.
 *
 * Only the header area acts as a drop zone (not the entire column body) so
 * this component does not interfere with the kanban `DnDProvider`'s
 * column-reorder and task-move droppables on the column body.
 *
 * The droppable data payload carries `{ kind: "column", columnId }` so the
 * `PromptAttachmentBoundary.onDragEnd` handler can discriminate this target
 * from board/role targets.
 *
 * IMPORTANT — nested DndContext interaction:
 *   `KanbanColumn` lives inside `widgets/kanban-board/DnDProvider` (its own
 *   `DndContext`). This component's droppable registers with whichever
 *   `DndContext` is closest in the React tree. To activate it for prompt
 *   attachment, the `PromptAttachmentBoundary` must wrap the view that
 *   contains `KanbanColumn`. In this MVP slice the KanbanBoard view does
 *   NOT receive a `PromptAttachmentBoundary` wrapper — a prompts side-panel
 *   inside KanbanBoard is deferred because a cross-route DnD from the
 *   BoardsList prompt panel is not viable in the current routing model.
 *   This component is SCAFFOLDED and will become functional when a follow-up
 *   slice adds a prompts panel inside KanbanBoard.
 *
 * When a prompt-attach drag is active over this header, an overlay is
 * rendered with a dashed accent border + semi-transparent accent fill
 * to clearly communicate the drop target.
 */
export function PromptDropZoneColumnHeader({
  columnId,
  className,
  ...columnHeaderProps
}: PromptDropZoneColumnHeaderProps): ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-drop:${columnId}`,
    data: { kind: "column", columnId },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(styles.wrapper, isOver && styles.over, className)}
    >
      <ColumnHeader {...columnHeaderProps} />
      {isOver && <div className={styles.overlay} aria-hidden="true" />}
    </div>
  );
}
