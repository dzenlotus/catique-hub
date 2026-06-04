/**
 * PinnedSection — drag-to-reorder Pinned boards in the AppSidebar.
 *
 * Round 4 / Stream O. Wraps the pinned list in a scoped
 * `<DragDropProvider>` so it doesn't fight with the kanban or
 * prompts-page providers when those mount in adjacent routes.
 *
 * Position math:
 *   - The `list_pinned_boards` IPC returns plain `Board` rows whose
 *     `position` is `boards.position` (in-space ordering), NOT the
 *     `pinned_boards.position` REAL used to sort the sidebar list.
 *   - We side-step exposing that via a richer IPC by **renumbering the
 *     full list to `1.0, 2.0, 3.0, …`** through
 *     `useReorderPinnedListMutation` after each drop. The pinned
 *     section caps at ~5-10 rows in practice, so N round-trips per
 *     drag stays cheap. See `entities/pinned-board/model/store.ts` for
 *     the trade-off rationale.
 *
 * A11y: keyboard reorder is NOT yet wired — only pointer-drag.
 * Project Map v3 doesn't spec a keyboard reorder modality for this
 * surface; revisit when WCAG audit lands. The drag handle still
 * advertises itself as an actionable element so screen-reader users
 * can locate it (label: "Drag <board> to reorder").
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";

import { useReorderPinnedListMutation } from "@entities/pinned-board";
import { useToast } from "@shared/lib";

import styles from "./PinnedSection.module.css";

interface PinnedBoardRow {
  id: string;
  name: string;
  spaceId: string;
}

export interface PinnedSectionProps {
  boards: ReadonlyArray<PinnedBoardRow>;
  onOpenBoard: (boardId: string) => void;
}

const SORTABLE_GROUP = "app-sidebar-pinned";
const ID_PREFIX = "pinned:";

export function PinnedSection({
  boards,
  onOpenBoard,
}: PinnedSectionProps): ReactElement {
  const reorderList = useReorderPinnedListMutation();
  const { pushToast } = useToast();

  // Server order (the prop) mapped to dnd-kit-prefixed ids so the
  // sortable manager can match drag events back to rows.
  const serverOrder = useMemo(
    () => boards.map((b) => `${ID_PREFIX}${b.id}`),
    [boards],
  );

  // Optimistic order kept in a ref so `move()` from @dnd-kit/helpers
  // can mutate it while the user is dragging without forcing a render
  // per pixel.
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null);
  const optimisticIdsRef = useRef<string[] | null>(null);

  const orderedIds = optimisticIds ?? serverOrder;
  const boardsById = useMemo(() => {
    const map = new Map<string, PinnedBoardRow>();
    for (const b of boards) map.set(b.id, b);
    return map;
  }, [boards]);
  const orderedBoards = useMemo<PinnedBoardRow[]>(() => {
    const out: PinnedBoardRow[] = [];
    for (const prefixed of orderedIds) {
      const bare = prefixed.startsWith(ID_PREFIX)
        ? prefixed.slice(ID_PREFIX.length)
        : prefixed;
      const row = boardsById.get(bare);
      if (row) out.push(row);
    }
    return out;
  }, [orderedIds, boardsById]);

  const handleDragStart = useCallback(
    (_event: DragStartEvent): void => {
      optimisticIdsRef.current = serverOrder;
      setOptimisticIds(serverOrder);
    },
    [serverOrder],
  );

  const handleDragOver = useCallback((event: DragOverEvent): void => {
    setOptimisticIds((current) => {
      if (current === null) return current;
      const bucket = { [SORTABLE_GROUP]: current };
      const next = move(bucket, event);
      const nextOrder = next[SORTABLE_GROUP] ?? current;
      optimisticIdsRef.current = nextOrder;
      return nextOrder;
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const finalOrder = optimisticIdsRef.current ?? serverOrder;
      optimisticIdsRef.current = null;
      setOptimisticIds(null);
      if (event.canceled) return;

      const bare = finalOrder.map((id) =>
        id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : id,
      );
      const sameOrder =
        bare.length === serverOrder.length &&
        bare.every((id, i) => `${ID_PREFIX}${id}` === serverOrder[i]);
      if (sameOrder) return;

      reorderList.mutate(bare, {
        onError: (err) =>
          pushToast(
            "error",
            `Failed to reorder pinned boards: ${err.message}`,
          ),
      });
    },
    [serverOrder, reorderList, pushToast],
  );

  return (
    <section
      className={styles.section}
      aria-labelledby="app-sidebar-pinned-title"
      data-testid="app-sidebar-pinned"
    >
      <h3 id="app-sidebar-pinned-title" className={styles.sectionTitle}>
        Pinned
      </h3>
      <DragDropProvider
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <ul className={styles.list} data-testid="app-sidebar-pinned-list">
          {orderedBoards.map((board, index) => (
            <SortablePinnedRow
              key={board.id}
              board={board}
              index={index}
              onOpenBoard={onOpenBoard}
            />
          ))}
        </ul>
      </DragDropProvider>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sortable row
// ─────────────────────────────────────────────────────────────────────────────

interface SortablePinnedRowProps {
  board: PinnedBoardRow;
  index: number;
  onOpenBoard: (boardId: string) => void;
}

function SortablePinnedRow({
  board,
  index,
  onOpenBoard,
}: SortablePinnedRowProps): ReactElement {
  const { ref, handleRef, isDragging } = useSortable({
    id: `${ID_PREFIX}${board.id}`,
    index,
    group: SORTABLE_GROUP,
    type: "pinned-board",
    accept: ["pinned-board"],
  });

  return (
    <li
      ref={(element) => ref(element)}
      className={styles.row}
      data-dragging={isDragging ? "true" : undefined}
      data-testid={`app-sidebar-pinned-row-${board.id}`}
    >
      <button
        type="button"
        ref={(element) => handleRef(element)}
        className={styles.dragHandle}
        aria-label={`Drag ${board.name} to reorder`}
        data-testid={`app-sidebar-pinned-handle-${board.id}`}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <button
        type="button"
        className={styles.rowBtn}
        onClick={() => onOpenBoard(board.id)}
        data-testid={`app-sidebar-pinned-board-${board.id}`}
      >
        {board.name}
      </button>
    </li>
  );
}
