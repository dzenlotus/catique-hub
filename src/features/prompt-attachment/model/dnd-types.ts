/**
 * DnD type constants and data shapes for the prompt-attachment feature.
 *
 * These are used as the `data` payload on draggable prompt items and
 * droppable targets so the `onDragEnd` handler can discriminate
 * which kind of drag just completed.
 */

/** Discriminant value placed on every draggable prompt item's data. */
export const PROMPT_DRAG_KIND = "prompt-attach" as const;

/** Data payload attached to a draggable prompt row. */
export interface PromptDragData {
  kind: typeof PROMPT_DRAG_KIND;
  promptId: string;
}

/**
 * Discriminated union of all possible prompt drop targets.
 *
 * Each variant carries a `kind` discriminant so `PromptAttachmentBoundary`
 * can branch cleanly without inspecting string prefixes on the droppable id.
 *
 * - `board`  — `PromptDropZoneBoardCard`  — droppable id: `board-drop:{boardId}`
 * - `role`   — `PromptDropZoneRoleCard`   — droppable id: `role-drop:{roleId}`
 * - `column` — `PromptDropZoneColumnHeader` — droppable id: `column-drop:{columnId}`
 *   (ColumnHeader wiring is scaffolded; the prompts side-panel in KanbanBoard
 *    is deferred to a follow-up slice — cross-route DnD from BoardsList panel
 *    to KanbanBoard column is not viable in the current routing model.)
 */
export type PromptDropTarget =
  | { kind: "board"; boardId: string }
  | { kind: "role"; roleId: string }
  | { kind: "column"; columnId: string };
