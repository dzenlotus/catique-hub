import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Settings } from "lucide-react";

import { ColumnHeader } from "@entities/column";
import type { Column } from "@entities/column";
import { TaskCard } from "@entities/task";
import type { Task } from "@entities/task";
import { Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";
import { ColumnEditor } from "@widgets/column-editor";

import styles from "./KanbanColumn.module.css";

export interface KanbanColumnProps {
  column: Column;
  tasks: Task[];
  /**
   * Called when the user submits the add-task form. Parent computes
   * the position via `dragLogic.computeNewPosition`.
   */
  onAddTask?: (columnId: string, title: string) => void;
  /** Forwarded to ColumnHeader. */
  onRenameColumn?: (id: string, newName: string) => void;
  /** Forwarded to ColumnHeader. */
  onDeleteColumn?: (id: string) => void;
  /** Forwarded to TaskCard click handler. */
  onTaskSelect?: (taskId: string) => void;
  /**
   * When true, render the column with no chrome — used inside the
   * `<DragOverlay>`. Inert (no DnD wiring, no add-task affordance).
   */
  dragOverlay?: boolean;
}

/**
 * `KanbanColumn` — one sortable column of tasks.
 *
 * Wraps two @dnd-kit features:
 *   - `useSortable` on the column itself (column-level reorder).
 *   - `useDroppable` on the column body so cross-column drops resolve
 *     to this column even when the user releases over an empty area.
 *   - `<SortableContext>` for the inner task list so the tasks become
 *     individually draggable + the keyboard-coordinate-getter works.
 *
 * Drag handle is the column header itself (entire header is draggable).
 * Tasks have their own drag affordance via the card body.
 */
export function KanbanColumn({
  column,
  tasks,
  onAddTask,
  onRenameColumn,
  onDeleteColumn,
  onTaskSelect,
  dragOverlay = false,
}: KanbanColumnProps): ReactElement {
  const [settingsColumnId, setSettingsColumnId] = useState<string | null>(null);

  const sortable = useSortable({
    id: column.id,
    data: { type: "column" },
    disabled: dragOverlay,
  });

  // Droppable for the empty space beneath the last task — lets the
  // user drop a card into a (possibly empty) column without aiming
  // at a sibling card.
  const droppable = useDroppable({
    id: column.id,
    data: { type: "column", columnId: column.id },
    disabled: dragOverlay,
  });

  const style: CSSProperties = dragOverlay
    ? {}
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.4 : 1,
      };

  const taskIds = tasks.map((t) => t.id);

  // Drag handle: a small grip rendered inside the header. We DON'T
  // spread sortable.listeners on the section root because:
  //   1. The section contains buttons (add-task, more-menu) — pointer
  //      events from those would otherwise bubble into the dnd-kit
  //      listener and racing with RAC's usePress occasionally swallows
  //      the click.
  //   2. A scoped grip gives keyboard users a single, predictable
  //      tabstop for "I want to move this column."
  const dragHandle = dragOverlay ? null : (
    <button
      type="button"
      ref={(node) => sortable.setActivatorNodeRef(node)}
      {...sortable.attributes}
      {...sortable.listeners}
      className={styles.dragHandle}
      aria-label={`Reorder column ${column.name}`}
      data-testid={`kanban-column-drag-handle-${column.id}`}
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>
  );

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        styles.column,
        droppable.isOver && styles.columnDropTarget,
      )}
      aria-label={`Column ${column.name}`}
      data-testid={`kanban-column-${column.id}`}
    >
      <div className={styles.headerRow}>
        <ColumnHeader
          id={column.id}
          name={column.name}
          taskCount={tasks.length}
          className={styles.headerFlex}
          {...(dragHandle ? { dragHandle } : {})}
          {...(onRenameColumn ? { onRename: onRenameColumn } : {})}
          {...(onDeleteColumn ? { onDelete: onDeleteColumn } : {})}
        />
        {!dragOverlay ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Настройки колонки"
            className={styles.settingsButton}
            onPress={() => setSettingsColumnId(column.id)}
            data-testid={`kanban-column-settings-${column.id}`}
          >
            <Settings size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <ColumnEditor
        columnId={settingsColumnId}
        onClose={() => setSettingsColumnId(null)}
      />

      <div ref={droppable.setNodeRef} className={styles.body}>
        <SortableContext
          items={taskIds}
          strategy={verticalListSortingStrategy}
        >
          {tasks.length === 0 ? (
            <p
              className={styles.empty}
              data-testid={`kanban-column-empty-${column.id}`}
            >
              No tasks yet.
              <br />
              Drop one here or use Add task below.
            </p>
          ) : (
            tasks.map((task) => (
              <SortableTaskItem
                key={task.id}
                task={task}
                {...(onTaskSelect ? { onSelect: onTaskSelect } : {})}
              />
            ))
          )}
        </SortableContext>
      </div>

      {!dragOverlay ? (
        <ColumnFooter
          columnId={column.id}
          {...(onAddTask ? { onAddTask } : {})}
        />
      ) : null}
    </section>
  );
}

interface SortableTaskItemProps {
  task: Task;
  onSelect?: (id: string) => void;
}

/**
 * Internal: wraps a TaskCard with @dnd-kit's `useSortable`. Lives in
 * the widget, not the entity, because the entity must not know about
 * dnd-kit (FSD rule: entities have zero knowledge of widgets/UX state).
 *
 * Listeners are attached to a small grip overlaying the top-right of
 * the card — keeps the card body fully clickable + keyboard activatable
 * without racing dnd-kit's pointerdown handler.
 */
function SortableTaskItem({
  task,
  onSelect,
}: SortableTaskItemProps): ReactElement {
  const sortable = useSortable({
    id: task.id,
    data: { type: "task", columnId: task.columnId },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
    position: "relative",
  };

  return (
    <div ref={sortable.setNodeRef} style={style}>
      <TaskCard task={task} {...(onSelect ? { onSelect } : {})} />
      <button
        type="button"
        ref={(node) => sortable.setActivatorNodeRef(node)}
        {...sortable.attributes}
        {...sortable.listeners}
        className={styles.taskDragHandle}
        aria-label={`Reorder task ${task.title}`}
        data-testid={`task-drag-handle-${task.id}`}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
    </div>
  );
}

interface ColumnFooterProps {
  columnId: string;
  onAddTask?: (columnId: string, title: string) => void;
}

function ColumnFooter({
  columnId,
  onAddTask,
}: ColumnFooterProps): ReactElement {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");

  const submit = (): void => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAddTask?.(columnId, trimmed);
    setTitle("");
    setIsAdding(false);
  };

  if (!isAdding) {
    return (
      <div className={styles.footer}>
        <Button
          variant="ghost"
          size="sm"
          className={styles.addButton}
          onPress={() => setIsAdding(true)}
          data-testid={`kanban-column-add-task-${columnId}`}
        >
          + Add task
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.footer}>
      <form
        className={styles.addForm}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          label="Task title"
          value={title}
          onChange={setTitle}
          placeholder="What needs doing?"
          autoFocus
        />
        <div className={styles.addFormActions}>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onPress={() => {
              setTitle("");
              setIsAdding(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit">
            Add
          </Button>
        </div>
      </form>
    </div>
  );
}
