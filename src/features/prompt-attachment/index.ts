/**
 * `features/prompt-attachment` — public surface.
 *
 * Provides building blocks for drag-to-attach a Prompt onto a drop target:
 *   - `PromptAttachmentBoundary`    — DndContext wrapper + mutation handler.
 *   - `DraggablePromptRow`          — makes any child prompt draggable.
 *   - `PromptDropZoneBoardCard`     — wraps BoardCard with a droppable zone.
 *   - `PromptDropZoneRoleCard`      — wraps RoleCard with a droppable zone.
 *   - `PromptDropZoneColumnHeader`  — wraps ColumnHeader with a droppable zone
 *                                     (scaffolded; active when a prompts panel
 *                                     is wired inside KanbanBoard).
 *
 * DnD type constants are also re-exported for consumers that need to
 * inspect drag payloads (e.g. custom collision detection).
 */

export { PROMPT_DRAG_KIND } from "./model";
export type { PromptDragData, PromptDropTarget } from "./model";

export {
  DraggablePromptRow,
  PromptDropZoneBoardCard,
  PromptDropZoneRoleCard,
  PromptDropZoneColumnHeader,
  PromptAttachmentBoundary,
} from "./ui";
export type {
  DraggablePromptRowProps,
  PromptDropZoneBoardCardProps,
  PromptDropZoneRoleCardProps,
  PromptDropZoneColumnHeaderProps,
  PromptAttachmentBoundaryProps,
} from "./ui";
