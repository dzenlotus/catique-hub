/**
 * `features/prompt-attachment` — public surface.
 *
 * Provides the three building blocks for drag-to-attach a Prompt onto a
 * Board target:
 *   - `PromptAttachmentBoundary`  — DndContext wrapper + mutation handler.
 *   - `DraggablePromptRow`        — makes any child prompt draggable.
 *   - `PromptDropZoneBoardCard`   — wraps BoardCard with a droppable zone.
 *
 * DnD type constants are also re-exported for consumers that need to
 * inspect drag payloads (e.g. custom collision detection).
 */

export { PROMPT_DRAG_KIND } from "./model";
export type { PromptDragData } from "./model";

export {
  DraggablePromptRow,
  PromptDropZoneBoardCard,
  PromptAttachmentBoundary,
} from "./ui";
export type {
  DraggablePromptRowProps,
  PromptDropZoneBoardCardProps,
  PromptAttachmentBoundaryProps,
} from "./ui";
