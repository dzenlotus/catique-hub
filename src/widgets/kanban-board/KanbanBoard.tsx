import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useLocation } from "wouter";
import {
  DragOverlay,
  defaultDropAnimationSideEffects,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { PixelCodingAppsWebsitesModule } from "@shared/ui/Icon";

import {
  useColumns,
  useCreateColumnMutation,
  useDeleteColumnMutation,
  useReorderColumnsMutation,
  useUpdateColumnMutation,
  type Column,
} from "@entities/column";
import { useBoard } from "@entities/board";
import {
  useTasksByBoard,
  useMoveTaskMutation,
  useDeleteTaskMutation,
  tasksKeys,
  type Task,
} from "@entities/task";
import { useQueryClient } from "@tanstack/react-query";
import { TaskCard } from "@entities/task";
import { PromptCard, usePrompts } from "@entities/prompt";
import { useRoles, type Role } from "@entities/role";
import { Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";
import { taskPath } from "@app/routes";
import { useToast } from "@app/providers/ToastProvider";
import {
  PromptAttachmentBoundary,
  DraggablePromptRow,
} from "@features/prompt-attachment";
import { TaskCreateDialog } from "@widgets/task-create-dialog";

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
  placementFromRects,
  reorderColumnIds,
} from "./dragLogic";
import { GroupingMenu } from "./KanbanBoard.parts";
import { BulkActionsBar } from "./BulkActionsBar";
import { useTaskSelection } from "./useTaskSelection";

import styles from "./KanbanBoard.module.css";

/** The three available grouping modes for the board. */
export type GroupingMode = "status" | "role" | "none";

/**
 * Drop animation config — the overlay tweens to the dragged item's
 * resting rect over 200 ms instead of vanishing instantly. Combined
 * with the optimistic onDragOver cache patch, the resting rect is
 * already at the destination column, so the overlay slides smoothly
 * into the target slot (no snap-back to source).
 */
const dropAnimationConfig: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: { opacity: "0.4" },
    },
  }),
};

/** A synthetic column used in "Role" and "None" grouping modes. */
interface SyntheticColumn {
  id: string;
  name: string;
  tasks: Task[];
}

function getStorageKey(boardId: string): string {
  return `catique:kanban:grouping:${boardId}`;
}

function readStoredGrouping(boardId: string): GroupingMode {
  try {
    const raw = localStorage.getItem(getStorageKey(boardId));
    if (raw === "status" || raw === "role" || raw === "none") return raw;
  } catch {
    // localStorage unavailable (SSR, security policy, etc.) — use default.
  }
  return "status";
}

function writeStoredGrouping(boardId: string, mode: GroupingMode): void {
  try {
    localStorage.setItem(getStorageKey(boardId), mode);
  } catch {
    // Ignore write failures.
  }
}

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
 *   - Grouping mode: "status" (real columns), "role" (synthetic per roleId),
 *     or "none" (single "All tasks" column). Persisted in localStorage.
 *
 * The four canonical async-UI states (loading, error, empty, populated)
 * mirror the convention from `widgets/boards-list`. An empty column
 * renders inline-empty copy; an empty board renders the full empty CTA.
 */
export function KanbanBoard({
  boardId,
  onTaskSelect,
}: KanbanBoardProps): ReactElement {
  const [, setLocation] = useLocation();
  const boardQuery = useBoard(boardId);
  const columnsQuery = useColumns(boardId);
  const tasksQuery = useTasksByBoard(boardId);
  const rolesQuery = useRoles();

  const boardName =
    boardQuery.status === "success"
      ? boardQuery.data.name
      : boardQuery.status === "pending"
        ? "…"
        : "Board";

  const createColumn = useCreateColumnMutation();
  const updateColumn = useUpdateColumnMutation();
  const deleteColumn = useDeleteColumnMutation();
  const reorderColumns = useReorderColumnsMutation();

  const moveTask = useMoveTaskMutation();
  const deleteTask = useDeleteTaskMutation();
  const queryClient = useQueryClient();

  const { pushToast } = useToast();

  const columns: Column[] = columnsQuery.data ?? [];
  const tasks: Task[] = tasksQuery.data ?? [];
  const roles: Role[] = rolesQuery.data ?? [];

  // ── Bulk task selection ────────────────────────────────────────────
  const selection = useTaskSelection();

  // Ref for the kanban area — used to scope Cmd+A so it only fires when
  // focus is inside the kanban board.
  const kanbanAreaRef = useRef<HTMLDivElement>(null);

  // Track the last-selected task id per column for Shift-click range.
  const lastSelectedRef = useRef<Map<string, string>>(new Map());

  const promptsQuery = usePrompts();
  const prompts = promptsQuery.data ?? [];

  // Grouping mode — default is "status", restored from localStorage.
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(() =>
    readStoredGrouping(boardId),
  );

  const handleGroupingChange = (mode: GroupingMode): void => {
    setGroupingMode(mode);
    writeStoredGrouping(boardId, mode);
  };

  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  // Modal task-creation: column id whose "+ Add task" was clicked.
  // null → dialog closed; string → open with that column prefilled.
  const [createTaskFromColumnId, setCreateTaskFromColumnId] =
    useState<string | null>(null);

  // Task-select handler: navigates to the task route (opens TaskDialog via
  // App-level route) and also forwards to the caller's onTaskSelect prop.
  const handleTaskSelect = useCallback(
    (id: string): void => {
      setLocation(taskPath(id));
      onTaskSelect?.(id);
    },
    [setLocation, onTaskSelect],
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

  // ── Bulk selection callbacks (need tasksByColumn) ──────────────────

  /**
   * Toggle-selection handler — handles Shift and Ctrl/Cmd modifiers.
   *
   * Shift-click: range-select within the same column (from last-selected
   * to the clicked task). Cross-column shift-click falls through to
   * single toggle.
   */
  const handleToggleTaskSelection = useCallback(
    (taskId: string, event: React.MouseEvent): void => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const colId = task.columnId;
      const lastId = lastSelectedRef.current.get(colId);

      if (event.shiftKey && lastId !== undefined && lastId !== taskId) {
        // Range-select within this column.
        const colTasks = (tasksByColumn[colId] ?? []).map((t) => t.id);
        selection.selectRange(lastId, taskId, colTasks);
        lastSelectedRef.current.set(colId, taskId);
        return;
      }

      // Ctrl/Cmd or plain toggle.
      selection.toggle(taskId);
      lastSelectedRef.current.set(colId, taskId);
    },
    [tasks, tasksByColumn, selection],
  );

  /**
   * Bulk "Move to column" handler — fires useMoveTaskMutation for each
   * selected id, then clears selection and shows a toast.
   */
  const handleBulkMove = useCallback(
    (targetColumnId: string): void => {
      const ids = [...selection.selected];
      if (ids.length === 0) return;

      const siblings = (tasksByColumn[targetColumnId] ?? []).map((t) => ({
        id: t.id,
        position: t.position,
      }));

      const promises = ids.map((id, idx) => {
        const position = computeNewPosition(siblings, siblings.length + idx);
        return moveTask.mutateAsync({
          boardId,
          id,
          columnId: targetColumnId,
          position,
        });
      });

      Promise.all(promises)
        .then(() => {
          pushToast(
            "success",
            `Moved ${String(ids.length)} ${ids.length === 1 ? "task" : "tasks"}`,
          );
          selection.clear();
        })
        .catch(() => {
          pushToast("error", "Failed to move some tasks");
        });
    },
    [selection, tasksByColumn, moveTask, boardId, pushToast],
  );

  /**
   * Bulk delete handler — fires useDeleteTaskMutation for each selected
   * id, then clears selection and shows a toast.
   */
  const handleBulkDelete = useCallback((): void => {
    const ids = [...selection.selected];
    if (ids.length === 0) return;

    const promises = ids.map((id) => deleteTask.mutateAsync({ id, boardId }));

    Promise.all(promises)
      .then(() => {
        pushToast(
          "success",
          `Deleted ${String(ids.length)} ${ids.length === 1 ? "task" : "tasks"}`,
        );
        selection.clear();
      })
      .catch(() => {
        pushToast("error", "Failed to delete some tasks");
      });
  }, [selection, deleteTask, boardId, pushToast]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  // Esc: clear selection (only when count > 0).
  // Cmd/Ctrl+A: select all tasks when focus is inside the kanban area.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && selection.selectionActive) {
        selection.clear();
        return;
      }

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key === "a") {
        const area = kanbanAreaRef.current;
        if (!area) return;
        const active = document.activeElement;
        if (active && area.contains(active)) {
          e.preventDefault();
          selection.select(tasks.map((t) => t.id));
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selection, tasks]);

  // ── Synthetic column derivation for "role" / "none" grouping ──────────

  /** Synthetic columns derived for "Role" grouping mode. */
  const roleColumns = useMemo((): SyntheticColumn[] => {
    const roleMap = new Map<string, Role>(roles.map((r) => [r.id, r]));
    const grouped = new Map<string | null, Task[]>();

    for (const t of [...tasks].sort((a, b) => a.position - b.position)) {
      const key = t.roleId ?? null;
      (grouped.get(key) ?? (() => {
        const arr: Task[] = [];
        grouped.set(key, arr);
        return arr;
      })()).push(t);
    }

    const cols: SyntheticColumn[] = [];
    // Named role columns first (in whatever order they appear in tasks).
    for (const [roleId, roleTasks] of grouped.entries()) {
      if (roleId === null) continue;
      const roleName = roleMap.get(roleId)?.name ?? roleId;
      cols.push({ id: `role:${roleId}`, name: roleName, tasks: roleTasks });
    }
    // "(no role)" column last.
    const noRoleTasks = grouped.get(null) ?? [];
    cols.push({ id: "role:null", name: "(no role)", tasks: noRoleTasks });
    return cols;
  }, [tasks, roles]);

  /** Synthetic single column for "None" grouping mode. */
  const noneColumns = useMemo((): SyntheticColumn[] => {
    const sorted = [...tasks].sort((a, b) => a.position - b.position);
    return [{ id: "all", name: "All tasks", tasks: sorted }];
  }, [tasks]);

  const lastOverIdRef = useRef<string | null>(null);

  // Custom collision detection.
  //
  // Column drags only consider column-as-sortable droppables.
  //
  // Task drags consider tasks AND column-body droppables
  // (`${columnId}:body`). The column-as-sortable droppable is EXCLUDED
  // for task drags so a card never reports the outer column rect as
  // its over-target — that would defeat the refinement step and
  // produce wobbly placement near column edges.
  //
  // The refinement step: when the first collision is a column-body
  // and that column has tasks, re-run closestCenter against just that
  // column's tasks so the card snaps to the nearest sibling — matches
  // Trello/Linear "slot" feedback expectations.
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

      // Task drag — exclude column-as-sortable so a hover in a column
      // doesn't beat its tasks for collision priority.
      const taskCandidates = args.droppableContainers.filter((c) => {
        const dataType = (c.data.current as { type?: string } | undefined)?.type;
        return dataType !== "column";
      });

      const pointer = pointerWithin({
        ...args,
        droppableContainers: taskCandidates,
      });
      const intersections =
        pointer.length > 0
          ? pointer
          : rectIntersection({ ...args, droppableContainers: taskCandidates });
      let overId = getFirstCollision(intersections, "id") as string | null;

      if (overId !== null) {
        // Column-body collision → refine to nearest task in that column
        // when one exists. Body droppable carries
        // `data: { type: "column-body", columnId }`.
        const bodyCol = taskCandidates.find((c) => String(c.id) === overId);
        const bodyData = bodyCol?.data.current as
          | { type?: string; columnId?: string }
          | undefined;
        if (bodyData?.type === "column-body" && bodyData.columnId) {
          const tasksInCol = tasksByColumn[bodyData.columnId] ?? [];
          if (tasksInCol.length > 0) {
            const taskIds = new Set(tasksInCol.map((t) => t.id));
            const refinement = closestCenter({
              ...args,
              droppableContainers: taskCandidates.filter((c) =>
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

  // Snapshot of the tasks-by-board cache taken on drag-start. Used to
  // restore the cache when a drag is cancelled (Esc or drop-on-nowhere)
  // because we mutate the cache during onDragOver to give continuous
  // visual reflow. Refs (not state) so changes don't trigger renders.
  const dragSnapshotRef = useRef<Task[] | null>(null);
  const lastOptimisticOverRef = useRef<string | null>(null);

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
      // Snapshot the by-board cache so onDragCancel can restore it.
      const key = tasksKeys.byBoard(boardId);
      const current = queryClient.getQueryData<Task[]>(key);
      dragSnapshotRef.current = current ? [...current] : null;
      lastOptimisticOverRef.current = null;
    }
  };

  // Optimistic mid-drag reflow.
  //
  // When the dragged task hovers a different column (or a different
  // task within the source column), we patch the by-board cache so the
  // ghost card visually flows into its destination slot. The mutation
  // on drop produces the same optimistic patch via `useMoveTaskMutation`
  // — that's idempotent here because the cache already matches.
  //
  // We bail out cheaply when the over-target hasn't changed since the
  // last reflow, otherwise this fires on every pointer move.
  const onDragOver = (event: DragOverEvent): void => {
    const activeType = (event.active.data.current as { type?: string })?.type;
    if (activeType !== "task") return;

    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;

    // De-dup: only reflow when the over-target id actually changed.
    if (lastOptimisticOverRef.current === overId) return;
    lastOptimisticOverRef.current = overId;

    const key = tasksKeys.byBoard(boardId);
    const current = queryClient.getQueryData<Task[]>(key);
    if (!current) return;
    const activeTask = current.find((t) => t.id === activeId);
    if (!activeTask) return;

    // Resolve target column the same way onDragEnd does.
    const overTask = current.find((t) => t.id === overId);
    const overData = event.over?.data.current as
      | { type?: string; columnId?: string }
      | undefined;
    const overColumnFromBody =
      overData?.type === "column-body" ? overData.columnId : undefined;
    const overColumnDirect = columns.find((c) => c.id === overId);
    const targetColumnId =
      overTask?.columnId ??
      overColumnFromBody ??
      overColumnDirect?.id ??
      activeTask.columnId;

    // Compute the optimistic position. Within the destination's
    // siblings (excluding the dragged task), drop ON a task → before
    // it; drop on column body → append.
    const siblings = current
      .filter((t) => t.columnId === targetColumnId && t.id !== activeId)
      .sort((a, b) => a.position - b.position);

    let newPosition: number;
    if (overTask && overTask.id !== activeId) {
      const idx = siblings.findIndex((s) => s.id === overTask.id);
      if (idx === -1) {
        newPosition = computeNewPosition(
          siblings.map((s) => ({ id: s.id, position: s.position })),
          siblings.length,
        );
      } else {
        const placement = placementFromRects(
          event.active.rect.current.translated ?? null,
          event.over?.rect ?? null,
        );
        const insertAt = placement === "before" ? idx : idx + 1;
        newPosition = computeNewPosition(
          siblings.map((s) => ({ id: s.id, position: s.position })),
          insertAt,
        );
      }
    } else {
      newPosition = computeNewPosition(
        siblings.map((s) => ({ id: s.id, position: s.position })),
        siblings.length,
      );
    }

    // No-op early-out (cheap stable check).
    if (
      activeTask.columnId === targetColumnId &&
      activeTask.position === newPosition
    ) {
      return;
    }

    queryClient.setQueryData<Task[]>(
      key,
      current.map((t) =>
        t.id === activeId
          ? { ...t, columnId: targetColumnId, position: newPosition }
          : t,
      ),
    );
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const activeType = (event.active.data.current as { type?: string })?.type;
    setActiveColumn(null);
    setActiveTask(null);
    // Reset the over-id sticky cache so the next drag starts clean.
    lastOverIdRef.current = null;
    lastOptimisticOverRef.current = null;
    dragSnapshotRef.current = null;

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

    // Resolve the destination column. Three cases:
    //   1. Over a task        — that task's columnId
    //   2. Over a column body — `over.data.current.columnId` (suffix `:body`)
    //   3. Over a column-as-sortable — `over.id` is the column id directly
    //      (only reachable when no tasks/body match; defensive fallback).
    const overTask = tasks.find((t) => t.id === overId);
    const overData = over.data.current as
      | { type?: string; columnId?: string }
      | undefined;
    const overColumnFromBody =
      overData?.type === "column-body" ? overData.columnId : undefined;
    const overColumnDirect = columns.find((c) => c.id === overId);
    const targetColumnId =
      overTask?.columnId ??
      overColumnFromBody ??
      overColumnDirect?.id ??
      activeTaskRow.columnId;

    // Build the destination siblings list (excluding the dragged task).
    const siblings = (tasksByColumn[targetColumnId] ?? [])
      .filter((t) => t.id !== activeId)
      .map((t) => ({ id: t.id, position: t.position }));

    let newPosition: number;
    if (overTask && overTask.id !== activeTaskRow.id) {
      // Drop ON another task — pick before/after by comparing rect
      // midpoints. Always-before would mean dropping at the bottom of
      // a column lands above the last card (Trello bug #1).
      const activeRect = active.rect.current.translated;
      const overRect = over.rect;
      const placement = placementFromRects(activeRect, overRect);
      const computed = computeNewPositionRelativeTo(siblings, overTask.id, placement);
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
    // Restore the by-board cache snapshot taken on dragStart so any
    // optimistic onDragOver patches are undone.
    if (dragSnapshotRef.current) {
      queryClient.setQueryData<Task[]>(
        tasksKeys.byBoard(boardId),
        dragSnapshotRef.current,
      );
    }
    dragSnapshotRef.current = null;
    lastOptimisticOverRef.current = null;
    lastOverIdRef.current = null;
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
            Couldn't load board: {columnsQuery.error.message}
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
            Couldn't load tasks: {tasksQuery.error.message}
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

  // Populated. Round 17: clicking "+ Add task" on a column opens
  // TaskCreateDialog prefilled with this column's context. The dialog
  // owns the title/description/role inputs and the create-mutation
  // call; KanbanBoard only tracks which column triggered it.
  const handleAddTask = (columnId: string): void => {
    setCreateTaskFromColumnId(columnId);
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

  // Whether DnD and column-add controls should be active.
  const isDndEnabled = groupingMode === "status";

  // ── Render helpers ─────────────────────────────────────────────────

  const renderStatusColumns = (): ReactElement => (
    <DnDProvider
      columnIds={columnIds}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className={styles.scroller} data-testid="kanban-dnd-provider">
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
            selectedTaskIds={selection.selected}
            selectionActive={selection.selectionActive}
            onToggleTaskSelection={handleToggleTaskSelection}
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

      <DragOverlay dropAnimation={dropAnimationConfig}>
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
  );

  const renderSyntheticColumns = (syntheticCols: SyntheticColumn[]): ReactElement => (
    <div className={styles.scroller}>
      {syntheticCols.map((sc) => (
        <SyntheticKanbanColumn
          key={sc.id}
          id={sc.id}
          name={sc.name}
          tasks={sc.tasks}
          onTaskSelect={handleTaskSelect}
          selectedTaskIds={selection.selected}
          selectionActive={selection.selectionActive}
          onToggleTaskSelection={handleToggleTaskSelection}
        />
      ))}
    </div>
  );

  return (
    <section className={styles.root} data-testid="kanban-board">
      <header className={styles.boardHeader}>
        {/* Left: engineering icon + board name + description (same line) */}
        <div className={styles.boardHeadingGroup}>
          <div className={styles.boardHeadingRow}>
            {/* Engineering icon — custom sprite icon per DS v1 mockup */}
            <PixelCodingAppsWebsitesModule
              width={20}
              height={20}
              aria-hidden
              className={styles.boardIcon}
            />
            <h2 className={styles.boardHeading}>{boardName}</h2>
            {boardQuery.status === "success" && boardQuery.data.description ? (
              <p className={styles.boardDescription}>
                {boardQuery.data.description}
              </p>
            ) : null}
          </div>
        </div>

        {/* Right: Group by dropdown + kebab + prompts toggle */}
        <div className={styles.boardHeaderActions}>
          {/* "Group by:" functional dropdown */}
          <GroupingMenu value={groupingMode} onChange={handleGroupingChange} />

          {/* Kebab menu */}
          <button
            type="button"
            className={styles.kebabButton}
            aria-label="Board options"
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>

          {/* Prompts panel toggle */}
          <Button
            variant="ghost"
            size="md"
            onPress={() => setIsPanelOpen((v) => !v)}
            aria-expanded={isPanelOpen}
            aria-controls="kanban-prompt-panel"
            data-testid="kanban-board-prompts-toggle"
          >
            <span className={styles.btnLabel}>
              {isPanelOpen ? (
                <ChevronRight size={14} aria-hidden="true" />
              ) : (
                <ChevronLeft size={14} aria-hidden="true" />
              )}
              Промпты
            </span>
          </Button>
        </div>
      </header>

      <PromptAttachmentBoundary>
        <div className={cn(styles.layout, isPanelOpen && styles.layoutWithPanel)}>
          <div className={styles.kanbanArea} ref={kanbanAreaRef}>
            {isDndEnabled
              ? renderStatusColumns()
              : groupingMode === "role"
                ? renderSyntheticColumns(roleColumns)
                : renderSyntheticColumns(noneColumns)}
          </div>

          {isPanelOpen && (
            <aside
              id="kanban-prompt-panel"
              className={styles.promptPanel}
              aria-label="Промпты для перетаскивания"
            >
              <p className={styles.panelHeading}>Промпты</p>
              <p className={styles.panelHint}>
                Перетащите промпт на заголовок колонки, чтобы прикрепить его.
              </p>
              {promptsQuery.status === "pending" ? (
                <div className={styles.panelList} data-testid="kanban-prompt-panel-loading">
                  {[0, 1, 2].map((i) => (
                    <PromptCard key={i} isPending />
                  ))}
                </div>
              ) : promptsQuery.status === "error" ? (
                <p className={styles.panelError}>
                  Не удалось загрузить промпты
                </p>
              ) : prompts.length === 0 ? (
                <p className={styles.panelEmpty}>Промптов пока нет</p>
              ) : (
                <ul className={styles.panelList} data-testid="kanban-prompt-panel-list">
                  {prompts.map((prompt) => (
                    <li key={prompt.id} className={styles.panelItem}>
                      <DraggablePromptRow promptId={prompt.id}>
                        <PromptCard prompt={prompt} />
                      </DraggablePromptRow>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </div>
      </PromptAttachmentBoundary>

      <BulkActionsBar
        count={selection.selected.size}
        columns={columns}
        onMoveTo={handleBulkMove}
        onDelete={handleBulkDelete}
        onClear={selection.clear}
      />

      {/* Modal task creation — opens when user clicks "+ Add task" on any
          column. Prefilled with current board + the originating column. */}
      <TaskCreateDialog
        isOpen={createTaskFromColumnId !== null}
        onClose={() => setCreateTaskFromColumnId(null)}
        defaultBoardId={boardId}
        defaultColumnId={createTaskFromColumnId}
      />
    </section>
  );
}

// ── SyntheticKanbanColumn ──────────────────────────────────────────────────

interface SyntheticKanbanColumnProps {
  id: string;
  name: string;
  tasks: Task[];
  onTaskSelect?: (taskId: string) => void;
  selectedTaskIds?: ReadonlySet<string>;
  selectionActive?: boolean;
  onToggleTaskSelection?: (taskId: string, event: React.MouseEvent) => void;
}

/**
 * Read-only column used in "Role" and "None" grouping modes.
 * No DnD, no add-task affordance, no rename/delete. Minimal chrome.
 */
function SyntheticKanbanColumn({
  id,
  name,
  tasks,
  onTaskSelect,
  selectedTaskIds,
  selectionActive = false,
  onToggleTaskSelection,
}: SyntheticKanbanColumnProps): ReactElement {
  return (
    <section
      className={styles.syntheticColumn}
      aria-label={`Column ${name}`}
      data-testid={`kanban-synthetic-column-${id}`}
    >
      <header className={styles.syntheticColumnHeader}>
        <h3 className={styles.syntheticColumnName}>{name}</h3>
      </header>
      <div className={styles.syntheticColumnBody}>
        {tasks.length === 0 ? (
          <p className={styles.syntheticColumnEmpty}>No tasks</p>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={selectedTaskIds?.has(task.id) ?? false}
              selectionActive={selectionActive}
              {...(onTaskSelect ? { onSelect: onTaskSelect } : {})}
              {...(onToggleTaskSelection
                ? { onToggleSelection: onToggleTaskSelection }
                : {})}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ── CreateFirstColumn ──────────────────────────────────────────────────────

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
