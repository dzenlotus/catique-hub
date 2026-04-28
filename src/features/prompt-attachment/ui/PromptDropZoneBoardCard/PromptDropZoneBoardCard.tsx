import type { ReactElement } from "react";
import { useDroppable } from "@dnd-kit/core";

import { BoardCard, type BoardCardProps } from "@entities/board";
import { cn } from "@shared/lib";

import styles from "./PromptDropZoneBoardCard.module.css";

export interface PromptDropZoneBoardCardProps
  extends Omit<BoardCardProps, "className"> {
  /**
   * The board id — used as the droppable id and stored in the droppable
   * data payload so `PromptAttachmentBoundary.onDragEnd` can resolve the
   * target without consulting the DOM.
   */
  boardId: string;
  /** Optional extra class forwarded to the wrapper (not to BoardCard). */
  className?: string;
}

/**
 * `PromptDropZoneBoardCard` — wraps `BoardCard` with dnd-kit droppable.
 *
 * When a prompt-attach drag is active over this card, an overlay is
 * rendered with a dashed accent border + semi-transparent accent fill
 * to clearly communicate the drop target. The overlay is placed with
 * `position: absolute` over the card so the card's own layout and
 * content are untouched.
 */
export function PromptDropZoneBoardCard({
  boardId,
  className,
  ...boardCardProps
}: PromptDropZoneBoardCardProps): ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `board-drop:${boardId}`,
    data: { boardId },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(styles.wrapper, isOver && styles.over, className)}
    >
      <BoardCard {...boardCardProps} />
      {isOver && <div className={styles.overlay} aria-hidden="true" />}
    </div>
  );
}
