/**
 * Row — leaf-row primitive for the secondary rail.
 *
 * The user-facing contract (see `EntityTree/index.ts`):
 *
 *   <Row
 *     isActive
 *     isDraggable
 *     sortableId="..."           // required when isDraggable=true
 *     sortableGroup="..."
 *     sortableType="..."
 *     sortableAccept={["..."]}
 *     sortableIndex={0}
 *     onClick={() => ...}
 *     testId="..."
 *     renderContent={({ handleRef, isDragging }) => ...}
 *   />
 *
 * Visual contract preserves the canonical sidebar geometry: 40-px min
 * height, 5×row-height red active strip at row-x=-5..0, accent-soft
 * underlay starting at row-x=`var(--space-2)`, hover overlay matching
 * the same shape but with `--color-overlay-hover`. Drag-handle is a
 * built-in 18×18 button that fades in on `.row:hover` / focus-visible
 * — wired to `useSortable`'s `handleRef` so plain row clicks still
 * select.
 *
 * Why the consumer's body is passed via `renderContent` (a render prop)
 * instead of children:
 *   - The primitive owns the row chrome (drag handle, active overlay)
 *     and needs to thread `handleRef` + `isDragging` back to the
 *     consumer in case the consumer wants the drag-affordance bound to
 *     a specific button inside its body. A render prop is the cleanest
 *     way to do that without dropping into a Context-as-component
 *     pattern for a single child slot.
 */

import { useCallback, type ReactElement, type ReactNode, type Ref } from "react";
import { useSortable } from "@dnd-kit/react/sortable";

import { cn } from "@shared/lib";

import styles from "./EntityTree.module.css";

export interface RowRenderContentArgs {
  /**
   * Drag-handle ref from `@dnd-kit/react`'s `useSortable`. The built-in
   * handle wired to this ref is the default affordance; consumers
   * writing a fully-custom body can opt into placing the handle
   * differently by attaching this ref to their own button.
   *
   * When the row is not draggable the ref is still typed for callers
   * but the handle is never registered with @dnd-kit.
   */
  handleRef: Ref<HTMLElement>;
  /** True while THIS row is the active drag source. */
  isDragging: boolean;
}

export interface RowProps {
  /** Drives the red strip + accent-soft underlay. */
  isActive?: boolean;
  /**
   * When `true` the row registers with `@dnd-kit/react`'s `useSortable`
   * and renders the built-in drag handle in the leading slot. The
   * caller MUST supply `sortableId` so @dnd-kit has a stable identity;
   * `sortableGroup`, `sortableType`, `sortableAccept`, `sortableIndex`
   * default to sensible values when omitted but are usually set by the
   * parent provider's drag-end handler contract.
   */
  isDraggable?: boolean;
  sortableId?: string;
  sortableGroup?: string;
  sortableType?: string;
  sortableAccept?: ReadonlyArray<string>;
  sortableIndex?: number;
  /** Stable test id stamped on the root `<li>`. */
  testId?: string;
  /** Click handler. Fires from the consumer body via `onClick` capture
   * on the row, NOT from the drag handle (which is scoped via
   * `handleRef` so it doesn't double-fire). Consumers that want the
   * row to act as a click surface should wire this to their `select`
   * action; bodies that own their own buttons can ignore it. */
  onClick?: () => void;
  /**
   * Render-prop slot. Receives `handleRef` + `isDragging` so consumers
   * can compose labels, menus, color pickers, droppables, etc., inside
   * the row.
   */
  renderContent: (args: RowRenderContentArgs) => ReactNode;
  /**
   * aria-label for the drag handle. Defaults to `"Drag"`; supply a
   * meaningful label (e.g. `"Drag Brainstorm"`) so screen-reader users
   * can tell which row the handle belongs to. The current convention
   * (PromptsPage / SkillStepsSection) is `"Drag <label>"`.
   */
  dragHandleAriaLabel?: string;
  /**
   * Stable test id for the built-in drag handle. Conventionally
   * `<scope>-handle-<entity-id>` to match the rest of the rail's
   * testid grammar.
   */
  dragHandleTestId?: string;
}

export function Row({
  isActive = false,
  isDraggable = false,
  sortableId,
  sortableGroup,
  sortableType,
  sortableAccept,
  sortableIndex,
  testId,
  onClick,
  renderContent,
  dragHandleAriaLabel = "Drag",
  dragHandleTestId,
}: RowProps): ReactElement {
  // Resolve sortable identity. When `isDraggable=false` the values are
  // not consumed (the hook is `disabled`), but @dnd-kit still wants a
  // string id — pass the testId / a stable fallback so hook ordering
  // stays consistent across renders.
  const resolvedId = sortableId ?? testId ?? "row";
  const resolvedGroup = sortableGroup ?? "row";
  const resolvedType = sortableType ?? "row";
  const resolvedAccept = sortableAccept ?? [resolvedType];
  const resolvedIndex = sortableIndex ?? 0;

  const sortable = useSortable({
    id: resolvedId,
    index: resolvedIndex,
    group: resolvedGroup,
    type: resolvedType,
    accept: [...resolvedAccept],
    disabled: !isDraggable,
  });

  // @dnd-kit's `ref` / `handleRef` are callback refs. Wrap them in
  // stable callbacks so React's ref-forwarding paths don't re-fire on
  // every render (which would unmount-and-remount the sortable
  // registration). The dependency on the hook's `ref` identity is
  // intentional — when the hook tears down, the callback should clear
  // the registered element.
  const liRef = useCallback(
    (element: HTMLLIElement | null): void => {
      sortable.ref(element);
    },
    [sortable.ref],
  );

  const handleRef = useCallback(
    (element: HTMLElement | null): void => {
      sortable.handleRef(element);
    },
    [sortable.handleRef],
  );

  const handleClick = (): void => {
    if (onClick !== undefined) onClick();
  };

  return (
    // The sortable ref MUST land on the `<li>` — putting it on the
    // inner row div collapses siblings into a single line when the
    // source row is dragged. The ref is only wired when `isDraggable`
    // is true so `useSortable` doesn't stamp ARIA attributes (role,
    // aria-roledescription, …) on disabled rows.
    <li
      ref={isDraggable ? liRef : undefined}
      className={styles.item}
      data-testid={testId}
      data-draggable={isDraggable ? "true" : undefined}
      data-dragging={sortable.isDragging ? "true" : undefined}
    >
      <div
        className={cn(styles.row, isActive && styles.rowActive)}
        onClick={handleClick}
      >
        {isDraggable ? (
          <button
            type="button"
            ref={handleRef as Ref<HTMLButtonElement>}
            className={styles.dragHandle}
            aria-label={dragHandleAriaLabel}
            data-testid={dragHandleTestId}
            // Prevent the row's onClick from firing when the user
            // activates the handle (mouse or keyboard) — the handle is
            // meant to start a drag, not to select the row.
            onClick={(event) => event.stopPropagation()}
          >
            <span aria-hidden="true">⋮⋮</span>
          </button>
        ) : null}
        <div className={styles.rowContent}>
          {renderContent({
            handleRef: handleRef as Ref<HTMLElement>,
            isDragging: sortable.isDragging,
          })}
        </div>
      </div>
    </li>
  );
}
