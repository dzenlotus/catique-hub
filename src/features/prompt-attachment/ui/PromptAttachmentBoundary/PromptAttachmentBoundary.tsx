import type { ReactNode, ReactElement } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";

import { useAddBoardPromptMutation } from "@entities/board";
import { useAddRolePromptMutation } from "@entities/role";
import { useAddColumnPromptMutation } from "@entities/column";

import {
  PROMPT_DRAG_KIND,
  type PromptDragData,
  type PromptDropTarget,
} from "../../model/dnd-types";

export interface PromptAttachmentBoundaryProps {
  children: ReactNode;
}

/**
 * `PromptAttachmentBoundary` — mounts a `DndContext` scoped to the
 * prompt-attachment interaction.
 *
 * Intentionally kept separate from the kanban `DnDProvider` to avoid
 * coupling between the kanban drag logic (column/task reorder) and the
 * prompt-attachment drag logic (prompt → board/role/column).
 *
 * On drop:
 *   1. Validates that the active item carries `kind === PROMPT_DRAG_KIND`.
 *   2. Reads `over.data.current` and casts to `PromptDropTarget`.
 *   3. Branches on `kind`:
 *      - `"board"`  → `useAddBoardPromptMutation`  (position: 0)
 *      - `"role"`   → `useAddRolePromptMutation`   (position: 0)
 *      - `"column"` → `useAddColumnPromptMutation` (position: 0)
 *
 * KanbanColumn / PromptDropZoneColumnHeader note:
 *   The `column` branch is wired here but `PromptDropZoneColumnHeader` is
 *   only scaffolded in this slice — the kanban view does not yet include a
 *   `PromptAttachmentBoundary` wrapper or a prompts side-panel. Cross-route
 *   DnD (from the BoardsList prompt panel into a different route's kanban
 *   columns) is not viable in the current routing model. The column drop
 *   will become functional when a follow-up slice adds the side-panel
 *   inside KanbanBoard and wraps it with this boundary.
 */
export function PromptAttachmentBoundary({
  children,
}: PromptAttachmentBoundaryProps): ReactElement {
  const addBoardPrompt = useAddBoardPromptMutation();
  const addRolePrompt = useAddRolePromptMutation();
  const addColumnPrompt = useAddColumnPromptMutation();

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

    const overData = over.data.current as PromptDropTarget | undefined;
    if (!overData) return;

    const { promptId } = activeData;

    switch (overData.kind) {
      case "board":
        addBoardPrompt.mutate({
          boardId: overData.boardId,
          promptId,
          position: 0,
        });
        break;

      case "role":
        addRolePrompt.mutate({
          roleId: overData.roleId,
          promptId,
          position: 0,
        });
        break;

      case "column":
        addColumnPrompt.mutate({
          columnId: overData.columnId,
          promptId,
          position: 0,
        });
        break;

      default:
        // Exhaustiveness guard — TypeScript narrows `overData` to `never` here.
        break;
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}
