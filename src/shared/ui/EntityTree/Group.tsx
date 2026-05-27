/**
 * Group — expandable row primitive. Same surface as `<Row>` plus a
 * chevron toggle in the leading slot and a `children` slot rendered
 * when `isExpand=true`.
 *
 *   <Group
 *     isActive
 *     isDraggable
 *     isExpand
 *     onToggleExpand={() => ...}
 *     sortable*={...}
 *     onClick={() => ...}
 *     testId="..."
 *     renderContent={({ handleRef, isDragging }) => ...}
 *   >
 *     <Row ... />
 *     <Row ... />
 *   </Group>
 *
 * Nested children render inside a sibling `<ul>` under the row when
 * expanded — same indent + gap as the canonical SpacesSidebar tree.
 * Consumers nest `<Row>` / `<Group>` inside the children slot; the
 * primitive does not own iteration.
 */

import { useCallback, type ReactElement, type ReactNode, type Ref } from "react";
import { useSortable } from "@dnd-kit/react/sortable";

import { cn } from "@shared/lib";

import { EntityTreeChevron } from "./EntityTreeChevron";
import styles from "./EntityTree.module.css";
import type { RowRenderContentArgs } from "./Row";

export interface GroupProps {
  isActive?: boolean;
  isDraggable?: boolean;
  /** Drives the chevron direction + whether `children` are mounted. */
  isExpand?: boolean;
  /** Fired when the chevron is clicked. Caller updates `isExpand`. */
  onToggleExpand?: () => void;
  sortableId?: string;
  sortableGroup?: string;
  sortableType?: string;
  sortableAccept?: ReadonlyArray<string>;
  sortableIndex?: number;
  testId?: string;
  onClick?: () => void;
  renderContent: (args: RowRenderContentArgs) => ReactNode;
  /**
   * Nested rows / groups. Rendered inside a sibling `<ul>` under the
   * row when `isExpand=true`; otherwise not mounted at all so React
   * Query / portals inside aren't kept alive needlessly.
   */
  children?: ReactNode;
  dragHandleAriaLabel?: string;
  dragHandleTestId?: string;
  /**
   * aria-label / testId for the chevron toggle button. Conventionally
   * `<scope>-toggle-<entity-id>` to match the rest of the rail's
   * testid grammar. Default chevron aria-label is
   * `"Expand"` / `"Collapse"` depending on the current `isExpand`
   * state; supply `chevronAriaLabel` to use a more specific phrase
   * (e.g. `"Expand Atlassian"`).
   */
  chevronAriaLabel?: string;
  chevronTestId?: string;
  /**
   * Stable test id for the children `<ul>` wrapper. Conventionally
   * `<scope>-children-<entity-id>`.
   */
  childrenTestId?: string;
}

export function Group({
  isActive = false,
  isDraggable = false,
  isExpand = false,
  onToggleExpand,
  sortableId,
  sortableGroup,
  sortableType,
  sortableAccept,
  sortableIndex,
  testId,
  onClick,
  renderContent,
  children,
  dragHandleAriaLabel = "Drag",
  dragHandleTestId,
  chevronAriaLabel,
  chevronTestId,
  childrenTestId,
}: GroupProps): ReactElement {
  const resolvedId = sortableId ?? testId ?? "group";
  const resolvedGroup = sortableGroup ?? "group";
  const resolvedType = sortableType ?? "group";
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

  const handleRowClick = (): void => {
    if (onClick !== undefined) onClick();
  };

  const handleChevronClick = (event: React.MouseEvent): void => {
    // Stop the click from bubbling to the row so chevron-toggle and
    // row-select don't fire together.
    event.stopPropagation();
    if (onToggleExpand !== undefined) onToggleExpand();
  };

  const resolvedChevronAriaLabel =
    chevronAriaLabel ?? (isExpand ? "Collapse" : "Expand");

  return (
    <li
      ref={isDraggable ? liRef : undefined}
      className={styles.item}
      data-testid={testId}
      data-draggable={isDraggable ? "true" : undefined}
      data-dragging={sortable.isDragging ? "true" : undefined}
    >
      <div
        className={cn(styles.row, isActive && styles.rowActive)}
        onClick={handleRowClick}
      >
        {isDraggable ? (
          <button
            type="button"
            ref={handleRef as Ref<HTMLButtonElement>}
            className={styles.dragHandle}
            aria-label={dragHandleAriaLabel}
            data-testid={dragHandleTestId}
            onClick={(event) => event.stopPropagation()}
          >
            <span aria-hidden="true">⋮⋮</span>
          </button>
        ) : null}
        <button
          type="button"
          className={styles.chevronBtn}
          onClick={handleChevronClick}
          aria-label={resolvedChevronAriaLabel}
          aria-expanded={isExpand}
          data-testid={chevronTestId}
        >
          <EntityTreeChevron open={isExpand} />
        </button>
        <div className={styles.rowContent}>
          {renderContent({
            handleRef: handleRef as Ref<HTMLElement>,
            isDragging: sortable.isDragging,
          })}
        </div>
      </div>

      {isExpand && children !== undefined ? (
        <ul
          className={styles.children}
          role="list"
          data-testid={childrenTestId}
        >
          {children}
        </ul>
      ) : null}
    </li>
  );
}
