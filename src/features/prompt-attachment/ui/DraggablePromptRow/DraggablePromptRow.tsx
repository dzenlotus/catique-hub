import type { ReactNode, ReactElement, CSSProperties } from "react";
import { useDraggable } from "@dnd-kit/core";

import { PROMPT_DRAG_KIND, type PromptDragData } from "../../model/dnd-types";

import styles from "./DraggablePromptRow.module.css";

export interface DraggablePromptRowProps {
  /** The prompt id — used for the draggable `id` and the drag payload. */
  promptId: string;
  /** Content to render inside the draggable wrapper (typically a PromptCard). */
  children: ReactNode;
}

/**
 * `DraggablePromptRow` — wraps any child with dnd-kit draggable behaviour.
 *
 * While dragging, the source element's opacity drops to 35% to indicate
 * the item has been "lifted". The drag id is `prompt-attach:{promptId}`;
 * the data payload uses `PROMPT_DRAG_KIND` so the boundary handler can
 * discriminate it from unrelated drags (e.g. kanban tasks).
 */
export function DraggablePromptRow({
  promptId,
  children,
}: DraggablePromptRowProps): ReactElement {
  const data: PromptDragData = { kind: PROMPT_DRAG_KIND, promptId };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `prompt-attach:${promptId}`,
    data,
  });

  const style: CSSProperties = isDragging ? { opacity: 0.35 } : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.row}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}
