import type { ReactElement, ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

export interface DnDProviderProps {
  /** Ordered column ids — the SortableContext for column reorder. */
  columnIds: string[];
  /** Custom collision detection produced by the parent. */
  collisionDetection: CollisionDetection;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  children: ReactNode;
}

/**
 * `DnDProvider` — thin wrapper around `<DndContext>` configured for
 * the kanban widget.
 *
 * Sensors are split per input modality so each gets the right
 * activation constraint:
 *   - `MouseSensor`: 5-px movement threshold so a click on a card body
 *     doesn't accidentally start a drag.
 *   - `TouchSensor`: 200-ms hold + 5-px tolerance so the user can scroll
 *     the kanban with a swipe without grabbing a card on every tap.
 *   - `KeyboardSensor` with `sortableKeyboardCoordinates` so Space
 *     grabs, arrow-keys move, Space drops, Esc cancels (WCAG 2.1.1).
 *
 * The outer `<SortableContext>` covers the column reorder; per-column
 * task `<SortableContext>` lives inside `KanbanColumn`.
 */
export function DnDProvider({
  columnIds,
  collisionDetection,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  children,
}: DnDProviderProps): ReactElement {
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext
        items={columnIds}
        strategy={horizontalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

// Re-exported helpers for `KanbanBoard.tsx` to compose its own
// collision-detection callback. Keeping these in one place makes the
// orchestrator easier to read (the heavy strategy is the
// custom one declared next to the widget).
export {
  closestCenter,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
};
export type { CollisionDetection };
