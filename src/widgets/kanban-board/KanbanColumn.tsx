import type { ReactElement } from "react";
import { useSortable } from "@dnd-kit/react/sortable";

import type { Column } from "@entities/column";
import { ColumnHeader } from "@entities/column";
import type { Task } from "@entities/task";
import { TaskCard } from "@entities/task";
import { cn } from "@shared/lib";

import styles from "./KanbanColumn.module.css";

interface SortableTaskProps {
  task: Task;
  index: number;
  columnId: string;
  isDoneColumn: boolean;
  onTaskSelect: (taskId: string) => void;
}

function SortableTask({
  task,
  index,
  columnId,
  isDoneColumn,
  onTaskSelect,
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
  onRenameColumn: (columnId: string, name: string) => void;
  onDeleteColumn: (columnId: string) => void;
}

export function KanbanColumn({
  column,
  index,
  tasks,
  onTaskSelect,
  onAddTask,
  onRenameColumn,
  onDeleteColumn,
}: KanbanColumnProps): ReactElement {
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
      aria-label="Перетащить колонку"
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

      <div className={styles.body}>
        {tasks.length === 0 ? (
          <button
            type="button"
            className={styles.empty}
            onClick={() => onAddTask(column.id)}
            data-testid={`kanban-column-empty-${column.id}`}
          >
            Задачи отсутствуют
          </button>
        ) : (
          tasks.map((task, taskIndex) => (
            <SortableTask
              key={task.id}
              task={task}
              index={taskIndex}
              columnId={column.id}
              isDoneColumn={isDoneColumn}
              onTaskSelect={onTaskSelect}
            />
          ))
        )}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.addTaskButton}
          onClick={() => onAddTask(column.id)}
        >
          <span aria-hidden="true">+</span>
          Add task
        </button>
      </div>
    </section>
  );
}
