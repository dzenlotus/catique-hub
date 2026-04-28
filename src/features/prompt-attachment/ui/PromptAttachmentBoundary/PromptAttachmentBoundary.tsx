import type { ReactNode, ReactElement } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";

import { useAddBoardPromptMutation } from "@entities/board";

import { PROMPT_DRAG_KIND, type PromptDragData } from "../../model/dnd-types";

export interface PromptAttachmentBoundaryProps {
  children: ReactNode;
}

/**
 * `PromptAttachmentBoundary` — mounts a `DndContext` scoped to the
 * prompt-attachment interaction.
 *
 * Intentionally kept separate from the kanban `DnDProvider` to avoid
 * coupling between the kanban drag logic (column/task reorder) and the
 * prompt-attachment drag logic (prompt → board).
 *
 * On drop:
 *   1. Validates that the active item carries `kind === PROMPT_DRAG_KIND`.
 *   2. Reads `over.data.current.boardId` from the droppable's data payload.
 *   3. Calls `useAddBoardPromptMutation` with `position: 0` (appended first;
 *      reordering is a post-MVP concern).
 */
export function PromptAttachmentBoundary({
  children,
}: PromptAttachmentBoundaryProps): ReactElement {
  const addBoardPrompt = useAddBoardPromptMutation();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as PromptDragData | undefined;
    if (!activeData || activeData.kind !== PROMPT_DRAG_KIND) return;

    const overData = over.data.current as { boardId?: string } | undefined;
    const boardId = overData?.boardId;
    if (!boardId) return;

    addBoardPrompt.mutate({
      boardId,
      promptId: activeData.promptId,
      position: 0,
    });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}
