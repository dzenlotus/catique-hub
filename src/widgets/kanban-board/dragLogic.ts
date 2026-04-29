/**
 * Drag-logic — pure functions, fully unit-tested.
 *
 * The kanban widget delegates every position calculation here so the
 * UI layer stays free of arithmetic. Bugs in gap-based positioning are
 * silent — you only notice them when two tasks occupy the same slot
 * and the next user-action overwrites one of them. Keep this file
 * pure (no React, no IPC, no @dnd-kit).
 *
 * Position scheme — gap-based:
 *   - Each task carries a `position: number` (f64 on Rust side).
 *   - Between two tasks A and B (A.position < B.position), a new task
 *     gets `(A.position + B.position) / 2`.
 *   - At the start of a column: `firstTask.position - 1`.
 *   - At the end of a column: `lastTask.position + 1`.
 *   - In an empty column: `1`.
 *
 * This avoids re-numbering siblings on every drop. Long-term collisions
 * are rare with f64 precision (~52 bits of mantissa = 4.5e15 distinct
 * positions before two midpoints alias). When collisions DO happen
 * (after thousands of drops in the same gap) the caller should run a
 * batch re-normalisation (1, 2, 3, ...). That's a follow-up: not
 * shipped in E3.1.
 */

export interface PositionedItem {
  id: string;
  position: number;
}

/**
 * Compute a new position for an item dropped at `targetIndex` inside
 * `siblings`, where `siblings` is the destination column's items
 * sorted by `position` ascending and EXCLUDING the dragged item.
 *
 * - `targetIndex === 0` → before the first sibling.
 * - `targetIndex === siblings.length` → after the last sibling.
 * - otherwise → between siblings[targetIndex - 1] and siblings[targetIndex].
 *
 * Returns `1` when `siblings` is empty.
 *
 * Why exclude the dragged item from `siblings`? When reordering inside
 * the same column, the caller would otherwise pass the original list
 * and the math would compute "midpoint between self and self" — never
 * what we want.
 */
export function computeNewPosition(
  siblings: ReadonlyArray<PositionedItem>,
  targetIndex: number,
): number {
  // Empty column case — start at 1 so we leave room before/after.
  if (siblings.length === 0) return 1;

  // Clamp into [0, siblings.length] — defensive; the widget never
  // passes out-of-range indices but a misuse should not corrupt
  // positions.
  const clampedIndex = Math.max(0, Math.min(targetIndex, siblings.length));

  if (clampedIndex === 0) {
    // Before the first sibling — leave a 1-unit gap so we can keep
    // dropping items further to the start.
    const first = siblings[0];
    if (!first) return 1;
    return first.position - 1;
  }

  if (clampedIndex === siblings.length) {
    // After the last sibling.
    const last = siblings[siblings.length - 1];
    if (!last) return 1;
    return last.position + 1;
  }

  const prev = siblings[clampedIndex - 1];
  const next = siblings[clampedIndex];
  if (!prev || !next) {
    // Unreachable given the clamp, but keeps TS happy and serves as a
    // sentinel if someone passes a sparse array.
    return 1;
  }
  return (prev.position + next.position) / 2;
}

/**
 * Same as `computeNewPosition` but accepts the `nearTargetId` of the
 * sibling the dragged item is dropped onto. The widget's drop handler
 * receives a target id from @dnd-kit's `over.id` — we resolve that to
 * an index here.
 *
 * Direction: dropping ON top of the target inserts BEFORE it. To
 * insert after, the caller passes `placement: "after"`.
 *
 * Returns `null` if `nearTargetId` is not present in `siblings`. The
 * caller should fall back to `computeNewPosition(siblings,
 * siblings.length)` (append).
 */
export function computeNewPositionRelativeTo(
  siblings: ReadonlyArray<PositionedItem>,
  nearTargetId: string,
  placement: "before" | "after" = "before",
): number | null {
  const idx = siblings.findIndex((s) => s.id === nearTargetId);
  if (idx === -1) return null;
  const insertAt = placement === "before" ? idx : idx + 1;
  return computeNewPosition(siblings, insertAt);
}

/**
 * Validate a drop. Returns `true` when the drop should be a no-op:
 *   - The drop target is the same as the source (dragged onto itself).
 *   - The drop would put the task back at the exact same position
 *     in the same column.
 *
 * The caller can short-circuit the IPC call for no-op drops, saving a
 * round-trip and avoiding optimistic-update churn.
 */
export interface NoOpDropArgs {
  draggedId: string;
  sourceColumnId: string;
  sourcePosition: number;
  targetColumnId: string;
  targetPosition: number;
  /** When the user dropped directly on the dragged item itself. */
  overId?: string | null;
}

export function isNoOpDrop(args: NoOpDropArgs): boolean {
  if (args.overId === args.draggedId) return true;
  if (
    args.sourceColumnId === args.targetColumnId &&
    args.sourcePosition === args.targetPosition
  ) {
    return true;
  }
  return false;
}

/**
 * Reorder columns: given the current `columns` and a `(activeId,
 * overId)` pair from the drag handler, return the new id-order.
 *
 * Returns `null` when:
 *   - `activeId === overId` (no movement),
 *   - either id is missing from `columns`.
 */
export function reorderColumnIds(
  columns: ReadonlyArray<{ id: string }>,
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null;

  const oldIdx = columns.findIndex((c) => c.id === activeId);
  const newIdx = columns.findIndex((c) => c.id === overId);
  if (oldIdx === -1 || newIdx === -1) return null;

  const ids = columns.map((c) => c.id);
  const [moved] = ids.splice(oldIdx, 1);
  if (moved === undefined) return null;
  ids.splice(newIdx, 0, moved);
  return ids;
}

/**
 * Determine whether the dragged card should land **before** or
 * **after** the hovered task, based on a vertical comparison of
 * their rects' centres.
 *
 * Why this matters: when the user drags a card and hovers over an
 * existing task, dnd-kit reports `over.id` but no positional hint.
 * Always inserting "before" means dragging onto the LAST card of a
 * column lands the card above it — which feels broken because the
 * user clearly intended to drop *below*.
 *
 * Inputs are the SAME shapes that `DragEndEvent.active.rect.current.translated`
 * and `DragEndEvent.over.rect` produce: bounding-rect-like objects
 * with `top` and `height`. We compare midpoints to avoid jitter at
 * the rect edges.
 */
export interface RectLike {
  top: number;
  height: number;
}

export function placementFromRects(
  activeRect: RectLike | null | undefined,
  overRect: RectLike | null | undefined,
): "before" | "after" {
  if (!activeRect || !overRect) return "before";
  const activeMid = activeRect.top + activeRect.height / 2;
  const overMid = overRect.top + overRect.height / 2;
  return activeMid < overMid ? "before" : "after";
}
