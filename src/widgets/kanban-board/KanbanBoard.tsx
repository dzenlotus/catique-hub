import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import { useLocation } from "wouter";

import { taskPath } from "@app/routes";
import { useToast } from "@app/providers/ToastProvider";
import { useBoard } from "@entities/board";
import type { Column } from "@entities/column";
import {
  useColumns,
  useDeleteColumnMutation,
  useReorderColumnsMutation,
  useUpdateColumnMutation,
} from "@entities/column";
import type { Task } from "@entities/task";
import { useMoveTaskMutation, useTasksByBoard } from "@entities/task";
import { Button, Scrollable } from "@shared/ui";
import {
  PixelCodingAppsWebsitesModule,
  PixelInterfaceEssentialSettingCog,
  PixelInterfaceEssentialPlus,
} from "@shared/ui/Icon";
import { cn } from "@shared/lib";
import { TaskCreateDialog } from "@widgets/task-create-dialog";
import { ColumnCreateDialog } from "@widgets/column-create-dialog";
import { lastBoardStore } from "@shared/storage";

import { KanbanColumn } from "./KanbanColumn";
import styles from "./KanbanBoard.module.css";

export interface KanbanBoardProps {
  boardId: string;
  onTaskSelect?: (taskId: string) => void;
}

type TaskBuckets = Record<string, Task[]>;
type BoardDragEvent = DragOverEvent | DragEndEvent;

function sourceType(event: BoardDragEvent): string | null {
  const type = event.operation.source?.type;
  return typeof type === "string" ? type : null;
}

function sourceId(event: BoardDragEvent): string | null {
  const id = event.operation.source?.id;
  return typeof id === "string" ? id : null;
}

function bucketTasks(columns: Column[], tasks: Task[]): TaskBuckets {
  const buckets: TaskBuckets = {};
  for (const column of columns) buckets[column.id] = [];

  for (const task of tasks) {
    if (!buckets[task.columnId]) buckets[task.columnId] = [];
    buckets[task.columnId].push(task);
  }

  for (const list of Object.values(buckets)) {
    list.sort((a, b) => a.position - b.position);
  }

  return buckets;
}

function findTask(
  buckets: TaskBuckets,
  taskId: string,
): { columnId: string; index: number } | null {
  for (const [columnId, tasks] of Object.entries(buckets)) {
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index >= 0) return { columnId, index };
  }

  return null;
}

function nextPosition(siblings: Task[], index: number): number {
  const targetIndex = Math.max(0, Math.min(index, siblings.length));

  if (siblings.length === 0) return 1;
  if (targetIndex === 0) return siblings[0].position - 1;
  if (targetIndex === siblings.length) {
    return siblings[siblings.length - 1].position + 1;
  }

  return (
    (siblings[targetIndex - 1].position + siblings[targetIndex].position) / 2
  );
}

function columnIds(columns: Column[]): string[] {
  return columns.map((column) => column.id);
}

export function KanbanBoard({
  boardId,
  onTaskSelect,
}: KanbanBoardProps): ReactElement {
  const [, setLocation] = useLocation();

  const boardQuery = useBoard(boardId);
  const columnsQuery = useColumns(boardId);
  const tasksQuery = useTasksByBoard(boardId);

  const updateColumn = useUpdateColumnMutation();
  const deleteColumn = useDeleteColumnMutation();
  const reorderColumns = useReorderColumnsMutation();
  const moveTask = useMoveTaskMutation();

  const { pushToast } = useToast();

  const [items, setItems] = useState<TaskBuckets>({});
  const itemsRef = useRef<TaskBuckets>({});
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const orderedIdsRef = useRef<string[]>([]);
  const draggingRef = useRef(false);

  // Ctq-76 item 4: column creation now lives in `ColumnCreateDialog`,
  // not in an inline form. We track only the dialog visibility here.
  const [isColumnDialogOpen, setIsColumnDialogOpen] = useState(false);
  const [taskColumnId, setTaskColumnId] = useState<string | null>(null);

  const columns = columnsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];

  const serverItems = useMemo(() => bucketTasks(columns, tasks), [columns, tasks]);

  const columnById = useMemo(() => {
    const map: Record<string, Column> = {};
    for (const column of columns) map[column.id] = column;
    return map;
  }, [columns]);

  const orderedColumns = useMemo(
    () =>
      orderedIds
        .map((id) => columnById[id])
        .filter((column): column is Column => column !== undefined),
    [columnById, orderedIds],
  );

  // F-04: gate the server-state overwrite on both `draggingRef` (the
  // user is currently dragging) AND any in-flight optimistic mutation
  // (the user just dropped, the mutation hasn't settled yet). Without
  // the mutation gate, a WS event arriving during drag would overwrite
  // the user's drop the instant `dragEnd` runs, before our optimistic
  // `moveTask.mutate` had a chance to round-trip.
  const isMutating = moveTask.isPending || reorderColumns.isPending;

  useEffect(() => {
    if (draggingRef.current) return;
    if (isMutating) return;
    setItems(serverItems);
    itemsRef.current = serverItems;
  }, [serverItems, isMutating]);

  // Persist this board as the last-opened for its space, so that on next
  // launch / when navigating to "/" we can redirect back to it. The store
  // internally swallows errors from restricted environments.
  useEffect(() => {
    const spaceId = boardQuery.data?.spaceId;
    if (!spaceId) return;
    lastBoardStore(spaceId).set(boardId);
  }, [boardId, boardQuery.data?.spaceId]);

  useEffect(() => {
    if (draggingRef.current) return;
    if (isMutating) return;
    const next = columnIds(columns);
    setOrderedIds(next);
    orderedIdsRef.current = next;
  }, [columns, isMutating]);

  const setSyncedItems = (updater: (current: TaskBuckets) => TaskBuckets): void => {
    setItems((current) => {
      const next = updater(current);
      itemsRef.current = next;
      return next;
    });
  };

  const setSyncedColumnIds = (updater: (current: string[]) => string[]): void => {
    setOrderedIds((current) => {
      const next = updater(current);
      orderedIdsRef.current = next;
      return next;
    });
  };

  const resetLocalOrder = (): void => {
    setItems(serverItems);
    itemsRef.current = serverItems;

    const nextIds = columnIds(columns);
    setOrderedIds(nextIds);
    orderedIdsRef.current = nextIds;
  };

  const handleDragStart = (_event: DragStartEvent): void => {
    draggingRef.current = true;
  };

  const handleDragOver = (event: DragOverEvent): void => {
    if (sourceType(event) === "column") {
      // F-08: `move<T>()` from @dnd-kit/helpers preserves the input shape
      // in its return type, so the inferred result is already `string[]`
      // / `TaskBuckets` — drop the redundant `as` cast.
      setSyncedColumnIds((current) => move(current, event));
      return;
    }

    setSyncedItems((current) => move(current, event));
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    draggingRef.current = false;

    if (event.canceled) {
      resetLocalOrder();
      return;
    }

    if (sourceType(event) === "column") {
      reorderColumns.mutate(
        { boardId, orderedIds: orderedIdsRef.current },
        {
          onError: (err) => {
            // Server rejected the reorder — drop the optimistic state and
            // show the user why. F-03 of docs/audit/kanban-frontend-audit.md.
            void columnsQuery.refetch();
            pushToast(
              "error",
              `Failed to reorder columns: ${err.message}`,
            );
          },
        },
      );
      return;
    }

    const taskId = sourceId(event);
    if (!taskId) return;

    const destination = findTask(itemsRef.current, taskId);
    const origin = findTask(serverItems, taskId);
    if (!destination || !origin) return;

    const siblings = (itemsRef.current[destination.columnId] ?? []).filter(
      (task) => task.id !== taskId,
    );
    const position = nextPosition(siblings, destination.index);
    const original = serverItems[origin.columnId]?.[origin.index];

    if (
      original &&
      original.columnId === destination.columnId &&
      original.position === position
    ) {
      return;
    }

    moveTask.mutate(
      {
        boardId,
        id: taskId,
        columnId: destination.columnId,
        position,
      },
      {
        onError: (err) => {
          // Roll back the optimistic move — the WS layer won't fire a
          // `task.moved` for a failed mutation, so we have to refetch
          // explicitly. F-03 of docs/audit/kanban-frontend-audit.md.
          void tasksQuery.refetch();
          pushToast("error", `Failed to move task: ${err.message}`);
        },
      },
    );
  };

  // Position assigned to a freshly-created column. Derived from the last
  // column's position because columns are positioned monotonically by
  // `useReorderColumnsMutation`. The mutation owns conflict-resolution
  // when two clients race, so we don't need to be exact.
  const nextColumnPosition = Number(columns.at(-1)?.position ?? 0n) + 1;

  // F-07: stabilise the per-column callback identities via useCallback so
  // the memoised `KanbanColumn` (below) can skip re-renders when only
  // unrelated state in this widget changes.
  const handleTaskSelect = useCallback(
    (taskId: string): void => {
      if (onTaskSelect) {
        onTaskSelect(taskId);
        return;
      }
      setLocation(taskPath(taskId));
    },
    [onTaskSelect, setLocation],
  );

  const handleRenameColumn = useCallback(
    (id: string, name: string): void => {
      updateColumn.mutate({ id, boardId, name });
    },
    [updateColumn, boardId],
  );

  const handleDeleteColumn = useCallback(
    (id: string): void => {
      deleteColumn.mutate({ id, boardId });
    },
    [deleteColumn, boardId],
  );

  if (columnsQuery.status === "pending" || tasksQuery.status === "pending") {
    return (
      <div className={styles.root}>
        <div className={cn(styles.scroller, styles.loadingScroller)}>
          {[0, 1, 2].map((column) => (
            <div className={styles.skeletonColumn} key={column}>
              <div className={styles.skeletonHeader} />
              {[0, 1, 2, 3].map((card) => (
                <div className={styles.skeletonCard} key={card} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (columnsQuery.status === "error" || tasksQuery.status === "error") {
    // Both queries are part of the kanban view; if either failed, show one
    // banner and refetch *both* on retry — otherwise a stuck second query
    // leaves the UI broken even after the user clicks Retry.
    // F-10 of docs/audit/kanban-frontend-audit.md.
    const message =
      columnsQuery.status === "error"
        ? columnsQuery.error.message
        : (tasksQuery.error?.message ?? "Unknown error");

    return (
      <div className={styles.root}>
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>Failed to load board: {message}</p>
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
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No columns yet</p>
          <p className={styles.emptyHint}>Add a column to start organizing tasks.</p>
          <Button variant="primary" onPress={() => setIsColumnDialogOpen(true)}>
            Create column
          </Button>
        </div>

        {/* Modal lives in the empty-state branch too so users hitting an
            empty board can immediately add a column. */}
        <ColumnCreateDialog
          isOpen={isColumnDialogOpen}
          onClose={() => setIsColumnDialogOpen(false)}
          boardId={boardId}
          nextPosition={nextColumnPosition}
        />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.boardHeader}>
        <div className={styles.boardTitle}>
          <PixelCodingAppsWebsitesModule
            width={20}
            height={20}
            aria-hidden="true"
            className={styles.boardIcon}
          />
          <h1 className={styles.boardHeading}>
            {boardQuery.data?.name ?? boardId}
          </h1>
          {boardQuery.data?.description ? (
            <p className={styles.boardDescription}>
              {boardQuery.data.description}
            </p>
          ) : null}
        </div>
        <button type="button" className={styles.iconButton} aria-label="Board options">
          <PixelInterfaceEssentialSettingCog
            width={16}
            height={16}
            aria-hidden="true"
          />
        </button>
      </header>

      <DragDropProvider
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <Scrollable
          axis="x"
          className={styles.scroller}
          data-testid="kanban-board-scroller"
        >
          {/* `.scrollerTrack` is the flex row that lays out columns.
           * It lives inside the OverlayScrollbars viewport, so the
           * host element's flex props don't reach it directly. */}
          <div className={styles.scrollerTrack}>
            {orderedColumns.map((column, index) => (
              <KanbanColumn
                key={column.id}
                column={column}
                index={index}
                tasks={items[column.id] ?? []}
                onTaskSelect={handleTaskSelect}
                onAddTask={setTaskColumnId}
                onRenameColumn={handleRenameColumn}
                onDeleteColumn={handleDeleteColumn}
              />
            ))}

            <div className={styles.addColumnContainer}>
              <Button
                variant="ghost"
                className={styles.addColumnButton}
                onPress={() => setIsColumnDialogOpen(true)}
                data-testid="kanban-board-add-column"
              >
                <span className={styles.addColumnLabel}>
                  <PixelInterfaceEssentialPlus
                    width={12}
                    height={12}
                    aria-hidden="true"
                  />
                  Add column
                </span>
              </Button>
            </div>
          </div>
        </Scrollable>
      </DragDropProvider>

      <TaskCreateDialog
        isOpen={taskColumnId !== null}
        onClose={() => setTaskColumnId(null)}
        defaultBoardId={boardId}
        defaultColumnId={taskColumnId}
      />

      <ColumnCreateDialog
        isOpen={isColumnDialogOpen}
        onClose={() => setIsColumnDialogOpen(false)}
        boardId={boardId}
        nextPosition={nextColumnPosition}
      />
    </div>
  );
}
