/**
 * DnD type constants and data shapes for the prompt-attachment feature.
 *
 * These are used as the `data` payload on draggable prompt items and
 * droppable board targets so the `onDragEnd` handler can discriminate
 * which kind of drag just completed.
 */

/** Discriminant value placed on every draggable prompt item's data. */
export const PROMPT_DRAG_KIND = "prompt-attach" as const;

/** Data payload attached to a draggable prompt row. */
export interface PromptDragData {
  kind: typeof PROMPT_DRAG_KIND;
  promptId: string;
}
