import { useState, useEffect } from "react";
import type { CSSProperties, ReactElement } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Settings } from "lucide-react";

import type { Column } from "@entities/column";
import { TaskCard } from "@entities/task";
import type { Task } from "@entities/task";
import { Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";
import { ColumnEditor } from "@widgets/column-editor";
import { PromptDropZoneColumnHeader } from "@features/prompt-attachment";

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
  /** Set of currently selected task ids. Forwarded to each TaskCard. */
  selectedTaskIds?: ReadonlySet<string>;
  /** Whether selection mode is active. Forwarded to each TaskCard. */
  selectionActive?: boolean;
  /**
   * Called when the user toggles a task's selection via checkbox or
   * body-click while selection mode is active.
   */
  onToggleTaskSelection?: (taskId: string, event: React.MouseEvent) => void;
}

/**
 * Heuristic: a column is a "done" column when its name (case-insensitive)
 * contains "done" or "готово". Used to propagate `isDoneColumn` to
 * TaskCard so it shows the green checkmark DS v1 indicator.
 */
function isDoneColumnName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("done") || lower.includes("готово");
}

/**
 * `KanbanColumn` — one sortable column of tasks.
 *
 * DS v1: `--color-surface-column` background, `--radius-lg` corners,
 * 12 px task gap, full-width dashed "+ Add task" button that goes solid
 * on hover. Passes `isDoneColumn` to each TaskCard for the checkmark.
 */
export function KanbanColumn({
  column,
  tasks,
  onAddTask,
  onRenameColumn,
  onDeleteColumn,
  onTaskSelect,
  dragOverlay = false,
  selectedTaskIds,
  selectionActive = false,
  onToggleTaskSelection,
}: KanbanColumnProps): ReactElement {
  const [settingsColumnId, setSettingsColumnId] = useState<string | null>(null);
  // Ref-based signal: header "+" click triggers the ColumnFooter's add-task form.
  const [headerAddTaskSignal, setHeaderAddTaskSignal] = useState(0);

  const sortable = useSortable({
    id: column.id,
    data: { type: "column" },
    disabled: dragOverlay,
  });

  // Droppable for the empty space beneath the last task — lets the
  // user drop a card into a (possibly empty) column without aiming
  // at a sibling card.
  //
  // ID note: must NOT collide with the column's own SortableContext id
  // (`column.id`), otherwise dnd-kit's collision detection cannot
  // distinguish "drop on column-as-droppable" from "drag column-as-
  // sortable". We append a `:body` suffix and resolve the actual
  // target column via `data.columnId` in the parent's drop handler.
  const droppable = useDroppable({
    id: `${column.id}:body`,
    data: { type: "column-body", columnId: column.id },
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

  const isDone = isDoneColumnName(column.name);

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
        <PromptDropZoneColumnHeader
          columnId={column.id}
          id={column.id}
          name={column.name}
          taskCount={tasks.length}
          className={styles.headerFlex}
          {...(dragHandle ? { dragHandle } : {})}
          {...(onRenameColumn ? { onRename: onRenameColumn } : {})}
          {...(onDeleteColumn ? { onDelete: onDeleteColumn } : {})}
          {...(!dragOverlay && onAddTask
            ? { onAddTask: () => setHeaderAddTaskSignal((n) => n + 1) }
            : {})}
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
              Задачи отсутствуют.
              <br />
              Перетащите или используйте «+ Добавить задачу».
            </p>
          ) : (
            tasks.map((task) => (
              <SortableTaskItem
                key={task.id}
                task={task}
                isDoneColumn={isDone}
                selected={selectedTaskIds?.has(task.id) ?? false}
                selectionActive={selectionActive}
                {...(onTaskSelect ? { onSelect: onTaskSelect } : {})}
                {...(onToggleTaskSelection
                  ? { onToggleSelection: onToggleTaskSelection }
                  : {})}
              />
            ))
          )}
        </SortableContext>
      </div>

      {!dragOverlay ? (
        <ColumnFooter
          columnId={column.id}
          openSignal={headerAddTaskSignal}
          {...(onAddTask ? { onAddTask } : {})}
        />
      ) : null}
    </section>
  );
}

interface SortableTaskItemProps {
  task: Task;
  isDoneColumn: boolean;
  onSelect?: (id: string) => void;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelection?: (id: string, event: React.MouseEvent) => void;
}

/**
 * Internal: wraps a TaskCard with @dnd-kit's `useSortable`. Lives in
 * the widget, not the entity, because the entity must not know about
 * dnd-kit (FSD rule: entities have zero knowledge of widgets/UX state).
 *
 * Whole-card drag: the activator is the wrapper div (not a tiny
 * handle button). MouseSensor's 5-px activation distance + the inner
 * checkbox's `stopPropagation` keeps clicks routed to TaskCard's
 * onClick (selection toggle), while a 5-px drag motion starts a
 * proper kanban drag — same affordance as Trello / Linear / GitHub
 * Projects.
 */
function SortableTaskItem({
  task,
  isDoneColumn,
  onSelect,
  selected = false,
  selectionActive = false,
  onToggleSelection,
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
    cursor: sortable.isDragging ? "grabbing" : "grab",
    touchAction: "none",
  };

  return (
    <div
      ref={(node) => {
        sortable.setNodeRef(node);
        sortable.setActivatorNodeRef(node);
      }}
      style={style}
      {...sortable.attributes}
      {...sortable.listeners}
      data-testid={`task-card-wrapper-${task.id}`}
    >
      <TaskCard
        task={task}
        isDoneColumn={isDoneColumn}
        selected={selected}
        selectionActive={selectionActive}
        {...(onSelect ? { onSelect } : {})}
        {...(onToggleSelection ? { onToggleSelection } : {})}
      />
    </div>
  );
}

interface ColumnFooterProps {
  columnId: string;
  onAddTask?: (columnId: string, title: string) => void;
  /** Incremented by the column header "+" button to open the add form. */
  openSignal?: number;
}

function ColumnFooter({
  columnId,
  onAddTask,
  openSignal = 0,
}: ColumnFooterProps): ReactElement {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");

  // When the header "+" button fires, open the inline add form.
  useEffect(() => {
    if (openSignal > 0) setIsAdding(true);
  }, [openSignal]);

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
          + Добавить задачу
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
