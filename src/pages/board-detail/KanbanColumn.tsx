import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { useSortable } from "@dnd-kit/react/sortable";

import type { Column } from "@entities/column";
import { ColumnHeader } from "@entities/column";
import type { Task } from "@entities/task";
import { TaskCard } from "@entities/task";
import { cn } from "@shared/lib";
import { Scrollable } from "@shared/ui";

import styles from "./KanbanColumn.module.css";

interface SortableTaskProps {
  task: Task;
  index: number;
  columnId: string;
  isDoneColumn: boolean;
  isSelected: boolean;
  selectionActive: boolean;
  onTaskSelect: (taskId: string) => void;
  onToggleSelection: (taskId: string, event: React.MouseEvent) => void;
}

function SortableTask({
  task,
  index,
  columnId,
  isDoneColumn,
  isSelected,
  selectionActive,
  onTaskSelect,
  onToggleSelection,
}: SortableTaskProps): ReactElement {
  const { ref, handleRef, isDragging } = useSortable({
    id: task.id,
    index,
    group: columnId,
    type: "task",
    accept: ["task"],
  });

  return (
    <TaskCard
      ref={ref}
      handleRef={handleRef as React.Ref<HTMLButtonElement>}
      task={task}
      isDoneColumn={isDoneColumn}
      onSelect={onTaskSelect}
      selected={isSelected}
      selectionActive={selectionActive}
      onToggleSelection={onToggleSelection}
      style={{
        opacity: isDragging ? 0.35 : 1,
        touchAction: "none",
      }}
    />
  );
}

export interface KanbanColumnProps {
  column: Column;
  index: number;
  tasks: Task[];
  onTaskSelect: (taskId: string) => void;
  onAddTask: (columnId: string) => void;
  /**
   * Round-19d: quick inline create. Receives the trimmed title; the
   * board owns boardId + position computation. Returning a Promise lets
   * the column show pending state until the IPC settles.
   */
  onQuickAddTask: (columnId: string, title: string) => Promise<void>;
  onRenameColumn: (columnId: string, name: string) => void;
  onDeleteColumn: (columnId: string) => void;
  /** Bulk-selection plumbing: see `useTaskSelection`. */
  selectedTaskIds: ReadonlySet<string>;
  selectionActive: boolean;
  onToggleTaskSelection: (taskId: string, event: React.MouseEvent) => void;
}

/**
 * F-07: wrapped in `memo` so unrelated state changes in `KanbanBoard`
 * (typing in the column-create input, opening the task dialog, etc.)
 * don't re-render every column. The parent stabilises every callback
 * via `useCallback`, which is required for the memo to actually skip.
 */
function KanbanColumnImpl({
  column,
  index,
  tasks,
  onTaskSelect,
  onAddTask,
  onQuickAddTask,
  onRenameColumn,
  onDeleteColumn,
  selectedTaskIds,
  selectionActive,
  onToggleTaskSelection,
}: KanbanColumnProps): ReactElement {
  // Quick-add inline form state. `null` = button visible; "" or any
  // string = inline input visible (typing in progress).
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (draftTitle !== null) {
      inputRef.current?.focus();
    }
  }, [draftTitle]);

  async function commitDraft(): Promise<void> {
    const trimmed = (draftTitle ?? "").trim();
    if (trimmed.length === 0) {
      setDraftTitle(null);
      return;
    }
    setIsCreating(true);
    try {
      await onQuickAddTask(column.id, trimmed);
      // Stay open for rapid-fire adds; clear the input.
      setDraftTitle("");
    } catch {
      // Errors surface via the board's toast handler.
    } finally {
      setIsCreating(false);
    }
  }

  function handleQuickKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitDraft();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraftTitle(null);
    }
  }
  const {
    ref: sortableRef,
    handleRef: sortableHandleRef,
    isDragging,
    isDropTarget,
  } = useSortable({
    id: column.id,
    index,
    group: "columns",
    type: "column",
    accept: ["column", "task"],
  });

  const setColumnRef = (element: HTMLElement | null): void => {
    sortableRef(element);
  };

  const isDoneColumn =
    column.name.toLowerCase().includes("done") ||
    column.name.toLowerCase().includes("готово");

  const dragHandle = (
    <button
      type="button"
      ref={sortableHandleRef as React.Ref<HTMLButtonElement>}
      className={styles.columnDragHandle}
      aria-label="Drag column"
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>
  );

  return (
    <section
      ref={setColumnRef}
      className={cn(
        styles.column,
        isDropTarget && styles.dropTarget,
        isDragging && styles.dragging,
      )}
      aria-label={`Column ${column.name}`}
      data-testid={`kanban-column-${column.id}`}
    >
      <ColumnHeader
        id={column.id}
        name={column.name}
        taskCount={tasks.length}
        dragHandle={dragHandle}
        onAddTask={onAddTask}
        onRename={onRenameColumn}
        onDelete={onDeleteColumn}
      />

      <Scrollable
        axis="y"
        className={styles.body}
        data-testid={`kanban-column-scroll-${column.id}`}
      >
        <div className={styles.bodyTrack}>
          {tasks.length === 0 ? (
            <button
              type="button"
              className={styles.empty}
              onClick={() => onAddTask(column.id)}
              aria-label={`Add task to ${column.name}`}
              data-testid={`kanban-column-empty-${column.id}`}
            >
              No tasks yet
            </button>
          ) : (
            tasks.map((task, taskIndex) => (
              <SortableTask
                key={task.id}
                task={task}
                index={taskIndex}
                columnId={column.id}
                isDoneColumn={isDoneColumn}
                isSelected={selectedTaskIds.has(task.id)}
                selectionActive={selectionActive}
                onTaskSelect={onTaskSelect}
                onToggleSelection={onToggleTaskSelection}
              />
            ))
          )}
        </div>
      </Scrollable>

      <div
        className={cn(
          styles.footer,
          draftTitle !== null && styles.footerOpen,
        )}
      >
        {draftTitle !== null ? (
          <input
            ref={inputRef}
            type="text"
            className={styles.quickInput}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={handleQuickKeyDown}
            onBlur={() => {
              // If empty on blur, collapse the form. Non-empty drafts
              // are preserved so a focus move into a toolbar / menu
              // doesn't lose the user's typing.
              if ((draftTitle ?? "").trim().length === 0) {
                setDraftTitle(null);
              }
            }}
            placeholder="Task title…"
            aria-label={`Quick add task to ${column.name}`}
            disabled={isCreating}
            data-testid={`kanban-column-quick-input-${column.id}`}
          />
        ) : (
          <button
            type="button"
            className={styles.addTaskButton}
            onClick={() => setDraftTitle("")}
            aria-label={`Add task to ${column.name}`}
            data-testid={`kanban-column-add-task-${column.id}`}
          >
            + Add task
          </button>
        )}
      </div>
    </section>
  );
}

export const KanbanColumn = memo(KanbanColumnImpl);
