import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useLocation } from "wouter";
import {
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { Icon } from "@shared/ui";

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
  useCreateTaskMutation,
  useMoveTaskMutation,
  type Task,
} from "@entities/task";
import { TaskCard } from "@entities/task";
import { PromptCard, usePrompts } from "@entities/prompt";
import { useRoles, type Role } from "@entities/role";
import { Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";
import { taskPath } from "@app/routes";
import {
  PromptAttachmentBoundary,
  DraggablePromptRow,
} from "@features/prompt-attachment";

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
import { GroupingMenu } from "./KanbanBoard.parts";

import styles from "./KanbanBoard.module.css";

/** The three available grouping modes for the board. */
export type GroupingMode = "status" | "role" | "none";

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

  const createTask = useCreateTaskMutation();
  const moveTask = useMoveTaskMutation();

  const columns: Column[] = columnsQuery.data ?? [];
  const tasks: Task[] = tasksQuery.data ?? [];
  const roles: Role[] = rolesQuery.data ?? [];

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
            <Icon
              name="engineering"
              size={20}
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
          <div className={styles.kanbanArea}>
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
    </section>
  );
}

// ── SyntheticKanbanColumn ──────────────────────────────────────────────────

interface SyntheticKanbanColumnProps {
  id: string;
  name: string;
  tasks: Task[];
  onTaskSelect?: (taskId: string) => void;
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
              {...(onTaskSelect ? { onSelect: onTaskSelect } : {})}
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
