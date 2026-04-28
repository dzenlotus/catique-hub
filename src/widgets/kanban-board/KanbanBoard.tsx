import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { TaskDialog } from "../task-dialog";
import {
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import {
  useColumns,
  useCreateColumnMutation,
  useDeleteColumnMutation,
  useReorderColumnsMutation,
  useUpdateColumnMutation,
  type Column,
} from "@entities/column";
import {
  useTasksByBoard,
  useCreateTaskMutation,
  useMoveTaskMutation,
  type Task,
} from "@entities/task";
import { TaskCard } from "@entities/task";
import { Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";

import { KanbanColumn } from "./KanbanColumn";
import {
  DnDProvider,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
} from "./DnDProvider";
import {
  computeNewPosition,
  computeNewPositionRelativeTo,
  isNoOpDrop,
  reorderColumnIds,
} from "./dragLogic";

import styles from "./KanbanBoard.module.css";

export interface KanbanBoardProps {
  /** Board id whose columns + tasks are rendered. */
  boardId: string;
  /** Optional task-select callback — surfaced for parent routing. */
  onTaskSelect?: (taskId: string) => void;
}

/**
 * `KanbanBoard` — the visual centerpiece.
 *
 * Owns:
 *   - `useColumns(boardId)` and `useTasksByBoard(boardId)`.
 *   - DnD context: column reorder + task move (within / across columns).
 *   - Optimistic mutations via `useReorderColumnsMutation` /
 *     `useMoveTaskMutation`. On error we restore the cache snapshot.
 *
 * The four canonical async-UI states (loading, error, empty, populated)
 * mirror the convention from `widgets/boards-list`. An empty column
 * renders inline-empty copy; an empty board renders the full empty CTA.
 */
export function KanbanBoard({
  boardId,
  onTaskSelect,
}: KanbanBoardProps): ReactElement {
  const columnsQuery = useColumns(boardId);
  const tasksQuery = useTasksByBoard(boardId);

  const createColumn = useCreateColumnMutation();
  const updateColumn = useUpdateColumnMutation();
  const deleteColumn = useDeleteColumnMutation();
  const reorderColumns = useReorderColumnsMutation();

  const createTask = useCreateTaskMutation();
  const moveTask = useMoveTaskMutation();

  const columns: Column[] = columnsQuery.data ?? [];
  const tasks: Task[] = tasksQuery.data ?? [];

  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Internal task-select handler: opens local TaskDialog and also
  // forwards to the caller's onTaskSelect prop if provided.
  const handleTaskSelect = useCallback(
    (id: string): void => {
      setSelectedTaskId(id);
      onTaskSelect?.(id);
    },
    [onTaskSelect],
  );

  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const columnIdSet = useMemo(() => new Set(columnIds), [columnIds]);

  const tasksByColumn = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const c of columns) grouped[c.id] = [];
    for (const t of [...tasks].sort((a, b) => a.position - b.position)) {
      (grouped[t.columnId] ??= []).push(t);
    }
    return grouped;
  }, [columns, tasks]);

  const lastOverIdRef = useRef<string | null>(null);

  // Custom collision detection — same shape as Promptery's, but
  // localised here. Column drags only consider column droppables; task
  // drags use pointerWithin → closestCenter against tasks-in-column.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const activeType = (args.active.data.current as { type?: string })?.type;
      if (activeType === "column") {
        const onlyColumns = args.droppableContainers.filter((c) =>
          columnIdSet.has(String(c.id)),
        );
        return closestCenter({
          ...args,
          droppableContainers: onlyColumns,
        });
      }

      // Task drag.
      const pointer = pointerWithin(args);
      const intersections = pointer.length > 0 ? pointer : rectIntersection(args);
      let overId = getFirstCollision(intersections, "id") as string | null;

      if (overId !== null) {
        if (columnIdSet.has(overId)) {
          // Hovering a column — refine to the nearest task within if any.
          const tasksInCol = tasksByColumn[overId] ?? [];
          if (tasksInCol.length > 0) {
            const taskIds = new Set(tasksInCol.map((t) => t.id));
            const refinement = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter((c) =>
                taskIds.has(String(c.id)),
              ),
            });
            const refinedId = getFirstCollision(refinement, "id") as
              | string
              | null;
            if (refinedId !== null) overId = refinedId;
          }
        }
        lastOverIdRef.current = overId;
        return [{ id: overId }];
      }

      return lastOverIdRef.current ? [{ id: lastOverIdRef.current }] : [];
    },
    [columnIdSet, tasksByColumn],
  );

  // ── Drag handlers ──────────────────────────────────────────────────

  const onDragStart = (event: DragStartEvent): void => {
    const type = (event.active.data.current as { type?: string })?.type;
    if (type === "column") {
      const col = columns.find((c) => c.id === String(event.active.id));
      if (col) setActiveColumn(col);
      return;
    }
    if (type === "task") {
      const t = tasks.find((x) => x.id === String(event.active.id));
      if (t) setActiveTask(t);
    }
  };

  // Mid-drag column inference: when the user hovers a different column
  // from the source, we pre-emptively update `activeTask.columnId` in
  // local state so the drop-end resolution computes positions against
  // the correct target. We don't write to the cache here — that
  // happens once on drop.
  const onDragOver = (_event: DragOverEvent): void => {
    // Intentionally no-op for E3.1 — the visual feedback comes from
    // dnd-kit's transform on the active item + the column's
    // `columnDropTarget` highlight via `useDroppable`. Cross-column
    // mid-drag insertion preview is a polish task deferred to the
    // post-launch UX pass (see kanban-structure.md §future).
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const activeType = (event.active.data.current as { type?: string })?.type;
    setActiveColumn(null);
    setActiveTask(null);

    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeType === "column") {
      const newOrder = reorderColumnIds(columns, activeId, overId);
      if (!newOrder) return;
      reorderColumns.mutate({ boardId, orderedIds: newOrder });
      return;
    }

    if (activeType !== "task") return;

    const activeTaskRow = tasks.find((t) => t.id === activeId);
    if (!activeTaskRow) return;

    // Resolve the destination column: drop on a task → that task's
    // column; drop on a column body → that column itself.
    const overTask = tasks.find((t) => t.id === overId);
    const overColumn = columns.find((c) => c.id === overId);
    const targetColumnId =
      overTask?.columnId ?? overColumn?.id ?? activeTaskRow.columnId;

    // Build the destination siblings list (excluding the dragged task).
    const siblings = (tasksByColumn[targetColumnId] ?? [])
      .filter((t) => t.id !== activeId)
      .map((t) => ({ id: t.id, position: t.position }));

    let newPosition: number;
    if (overTask && overTask.id !== activeTaskRow.id) {
      // Drop ON another task — insert before it.
      const computed = computeNewPositionRelativeTo(siblings, overTask.id, "before");
      newPosition = computed ?? computeNewPosition(siblings, siblings.length);
    } else {
      // Drop on column body — append to end.
      newPosition = computeNewPosition(siblings, siblings.length);
    }

    const noop = isNoOpDrop({
      draggedId: activeId,
      sourceColumnId: activeTaskRow.columnId,
      sourcePosition: activeTaskRow.position,
      targetColumnId,
      targetPosition: newPosition,
      overId,
    });
    if (noop) return;

    moveTask.mutate({
      boardId,
      id: activeId,
      columnId: targetColumnId,
      position: newPosition,
    });
  };

  const onDragCancel = (): void => {
    setActiveColumn(null);
    setActiveTask(null);
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (columnsQuery.status === "pending" || tasksQuery.status === "pending") {
    return (
      <section className={styles.root} aria-busy="true">
        <div
          className={styles.loadingScroller}
          data-testid="kanban-board-loading"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.skeletonColumn}>
              <div className={styles.skeletonHeader} />
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className={styles.skeletonCard} />
              ))}
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (columnsQuery.status === "error") {
    return (
      <section className={styles.root}>
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Couldn’t load board: {columnsQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void columnsQuery.refetch();
              void tasksQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }
  if (tasksQuery.status === "error") {
    return (
      <section className={styles.root}>
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Couldn’t load tasks: {tasksQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void tasksQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }

  // Empty board (no columns).
  if (columns.length === 0) {
    return (
      <section className={styles.root}>
        <div className={styles.empty} data-testid="kanban-board-empty">
          <p className={styles.emptyTitle}>No columns yet</p>
          <p className={styles.emptyHint}>
            Columns are the workflow lanes. Create your first one to start
            organising tasks.
          </p>
          <CreateFirstColumn
            onCreate={(name) => {
              createColumn.mutate({
                boardId,
                name,
                position: 1,
              });
            }}
          />
        </div>
      </section>
    );
  }

  // Populated.
  const handleAddTask = (columnId: string, title: string): void => {
    const siblings = (tasksByColumn[columnId] ?? []).map((t) => ({
      id: t.id,
      position: t.position,
    }));
    const position = computeNewPosition(siblings, siblings.length);
    createTask.mutate({ boardId, columnId, title, position });
  };

  const handleSubmitNewColumn = (): void => {
    const name = newColumnName.trim();
    if (!name) return;
    const lastPos = columns.length
      ? Number(columns[columns.length - 1]!.position)
      : 0;
    createColumn.mutate({
      boardId,
      name,
      position: lastPos + 1,
    });
    setNewColumnName("");
    setIsAddingColumn(false);
  };

  return (
    <section className={styles.root} data-testid="kanban-board">
      <DnDProvider
        columnIds={columnIds}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className={styles.scroller}>
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByColumn[column.id] ?? []}
              onAddTask={handleAddTask}
              onRenameColumn={(id, name) =>
                updateColumn.mutate({ id, boardId, name })
              }
              onDeleteColumn={(id) =>
                deleteColumn.mutate({ id, boardId })
              }
              onTaskSelect={handleTaskSelect}
            />
          ))}

          <div className={styles.addColumnContainer}>
            {isAddingColumn ? (
              <form
                className={styles.addColumnForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmitNewColumn();
                }}
              >
                <Input
                  label="Column name"
                  value={newColumnName}
                  onChange={setNewColumnName}
                  placeholder="e.g. In review"
                  autoFocus
                />
                <div className={styles.addColumnFormActions}>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onPress={() => {
                      setNewColumnName("");
                      setIsAddingColumn(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" type="submit">
                    Add
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                variant="ghost"
                size="md"
                className={cn(styles.addColumnButton)}
                onPress={() => setIsAddingColumn(true)}
                data-testid="kanban-board-add-column"
              >
                + Add column
              </Button>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeColumn ? (
            <KanbanColumn
              column={activeColumn}
              tasks={tasksByColumn[activeColumn.id] ?? []}
              dragOverlay
            />
          ) : activeTask ? (
            <TaskCard task={activeTask} dragOverlay />
          ) : null}
        </DragOverlay>
      </DnDProvider>

      <TaskDialog
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
      />
    </section>
  );
}

interface CreateFirstColumnProps {
  onCreate: (name: string) => void;
}

function CreateFirstColumn({
  onCreate,
}: CreateFirstColumnProps): ReactElement {
  const [name, setName] = useState("");
  const [showInput, setShowInput] = useState(false);

  if (!showInput) {
    return (
      <Button
        variant="primary"
        size="md"
        onPress={() => setShowInput(true)}
        data-testid="kanban-board-create-first-column"
      >
        Create your first column
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onCreate(trimmed);
        setName("");
        setShowInput(false);
      }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
    >
      <Input
        label="Column name"
        value={name}
        onChange={setName}
        placeholder="e.g. To do"
        autoFocus
      />
      <div style={{ display: "flex", gap: "var(--space-8)", justifyContent: "center" }}>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onPress={() => {
            setName("");
            setShowInput(false);
          }}
        >
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit">
          Create
        </Button>
      </div>
    </form>
  );
}
