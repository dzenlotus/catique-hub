import type { ReactElement, ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
 * Sensors:
 *   - `PointerSensor` with a 6-px activation distance so single-click
 *     interactions on a card don't initiate a drag.
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
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
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
