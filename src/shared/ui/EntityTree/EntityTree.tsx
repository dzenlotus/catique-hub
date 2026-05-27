/**
 * EntityTree — pure data-driven sidebar list/tree.
 *
 *   <EntityTree
 *     testIdPrefix="roles-sidebar"
 *     title="ROLES"
 *     titleTrailingNode={<AddButton />}
 *     data={[{ id, label, data?, children? }]}
 *     rowConfig={(node) => ({ isActive, onClick, draggable, ... })}
 *     renderRow={({ node }) => <CustomBody />}   // optional — defaults to <span>{label}</span>
 *   />
 *
 * The tree owns only the row chrome:
 *   - active strip + hover overlay
 *   - drag handle (when `draggable` is set in rowConfig)
 *   - chevron toggle + nested `<ul>` (for nodes with children, or
 *     when `expandable` is set)
 *
 * Row contents — labels, kebab menus, droppable wrappers, icons —
 * live in the consumer's `renderRow`. Without `renderRow` only the
 * node `label` is shown.
 *
 * Section chrome (title, loading/error/empty states) is optional and
 * fully passive: the consumer supplies any add / settings / filter
 * affordances via `titleTrailingNode`. EntityTree never renders
 * action buttons of its own.
 */

import {
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useDroppable } from "@dnd-kit/react";

import { Group } from "./Group";
import { RailSection } from "./RailSection";
import { Row } from "./Row";
import styles from "./EntityTree.module.css";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EntityTreeNode<T = unknown> {
  /** Stable id. Used as React key, sortable id, default test-id suffix. */
  id: string;
  /** Default row text — shown when `renderRow` is not supplied. */
  label: string;
  /** Free-form payload the consumer can read inside `rowConfig` / `renderRow`. */
  data?: T;
  /** Nested rows. Presence promotes the node from `<Row>` to `<Group>`. */
  children?: ReadonlyArray<EntityTreeNode<T>>;
}

export interface EntityTreeDraggable {
  /** Sortable type — e.g. "prompt", "board". */
  type: string;
  /** Sortable group id; rows in the same group reorder among themselves. */
  group?: string;
  /** Index inside the group; auto-derived from data position when absent. */
  index?: number;
  /** Override aria-label on the drag handle. Defaults to `Drag ${label}`. */
  handleAriaLabel?: string;
}

export interface EntityTreeDroppable {
  /** Droppable type — surfaces in @dnd-kit's onDragEnd target metadata. */
  type: string;
  /** Sortable types the drop target accepts. */
  accept: ReadonlyArray<string>;
  /**
   * Override the droppable id. Defaults to `${type}:${node.id}` so the
   * drag-end handler can route by parsing the id without a side-channel.
   */
  id?: string;
}

export interface EntityTreeRowConfig {
  /** Drives the red active strip + accent-soft underlay. */
  isActive?: boolean;
  /** Click handler — typically navigates / selects the node. */
  onClick?: () => void;
  /** Forces a node to render as `<Group>` even with no children. */
  expandable?: boolean;
  /** Controlled expand state. Omit to use uncontrolled per-row state. */
  isExpanded?: boolean;
  /** Toggle handler for controlled expand state. */
  onToggleExpand?: () => void;
  /** Initial expand state for uncontrolled mode. Default `false`. */
  defaultExpanded?: boolean;
  /** Drag source spec. Omit to keep the row non-draggable. */
  draggable?: EntityTreeDraggable;
  /** Drop target spec. Omit to keep the row non-droppable. */
  droppable?: EntityTreeDroppable;
  /** Override aria-label on the chevron. */
  chevronAriaLabel?: string;
}

export interface EntityTreeRenderRowArgs<T> {
  node: EntityTreeNode<T>;
  depth: number;
  isActive: boolean;
  isExpanded: boolean;
}

export interface EntityTreeProps<T = unknown> {
  /** Stamped on every test-id this tree emits. */
  testIdPrefix: string;
  /** Flat or hierarchical node list. */
  data: ReadonlyArray<EntityTreeNode<T>>;

  // ── Section chrome (optional) ─────────────────────────────────────
  title?: string;
  titleAriaLabel?: string;
  /**
   * Trailing affordances rendered after the section label — typically
   * add buttons, filter toggles, settings cogs. EntityTree never adds
   * its own; the consumer owns 100 % of section actions.
   */
  titleTrailingNode?: ReactNode;

  // ── Section states (only honoured when `title` is set) ────────────
  isLoading?: boolean;
  errorMessage?: string | null;
  emptyText?: string;

  // ── Per-row config + custom render ────────────────────────────────
  rowConfig?: (
    node: EntityTreeNode<T>,
    depth: number,
  ) => EntityTreeRowConfig | undefined;
  /**
   * Optional render slot for the row body. Without it the tree shows
   * `<span>{node.label}</span>` so consumers that only need a flat
   * text rail don't have to wire a render prop.
   */
  renderRow?: (args: EntityTreeRenderRowArgs<T>) => ReactNode;
}

// ---------------------------------------------------------------------------
// EntityTree
// ---------------------------------------------------------------------------

export function EntityTree<T = unknown>({
  testIdPrefix,
  data,
  title,
  titleAriaLabel,
  titleTrailingNode,
  isLoading,
  errorMessage,
  emptyText,
  rowConfig,
  renderRow,
}: EntityTreeProps<T>): ReactElement {
  const nodes = (
    <>
      {data.map((node, index) => (
        <EntityTreeNodeView
          key={node.id}
          node={node}
          depth={0}
          index={index}
          testIdPrefix={testIdPrefix}
          rowConfig={rowConfig}
          renderRow={renderRow}
        />
      ))}
    </>
  );

  if (title !== undefined) {
    return (
      <RailSection
        title={title}
        {...(titleAriaLabel !== undefined ? { titleAriaLabel } : {})}
        {...(titleTrailingNode !== undefined ? { titleTrailingNode } : {})}
        testIdPrefix={testIdPrefix}
        {...(isLoading !== undefined ? { isLoading } : {})}
        {...(errorMessage !== undefined ? { errorMessage } : {})}
        {...(emptyText !== undefined ? { emptyText } : {})}
        isEmpty={data.length === 0}
      >
        {nodes}
      </RailSection>
    );
  }

  // Headerless tree — just the `<ul>`. Consumer owns surrounding chrome.
  if (data.length === 0) {
    return (
      <div
        className={styles.bodyEmpty}
        data-testid={`${testIdPrefix}-empty`}
      >
        <span className={styles.bodyEmptyText}>
          {emptyText ?? "Nothing here yet."}
        </span>
      </div>
    );
  }
  return (
    <ul className={styles.list} role="list" data-testid={`${testIdPrefix}-list`}>
      {nodes}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Internal — recursive node renderer
// ---------------------------------------------------------------------------

interface EntityTreeNodeViewProps<T> {
  node: EntityTreeNode<T>;
  depth: number;
  index: number;
  testIdPrefix: string;
  rowConfig?: EntityTreeProps<T>["rowConfig"];
  renderRow?: EntityTreeProps<T>["renderRow"];
}

function EntityTreeNodeView<T>({
  node,
  depth,
  index,
  testIdPrefix,
  rowConfig,
  renderRow,
}: EntityTreeNodeViewProps<T>): ReactElement {
  const config = rowConfig?.(node, depth) ?? {};
  const hasChildren = (node.children ?? []).length > 0;
  const isGroup = hasChildren || config.expandable === true;

  // Uncontrolled expand state — only consulted when the consumer didn't
  // pass `isExpanded` / `onToggleExpand` through `rowConfig`.
  const [internalExpanded, setInternalExpanded] = useState<boolean>(
    config.defaultExpanded ?? false,
  );
  const isExpanded = config.isExpanded ?? internalExpanded;
  const toggleExpand = useCallback((): void => {
    if (config.onToggleExpand !== undefined) {
      config.onToggleExpand();
      return;
    }
    setInternalExpanded((prev) => !prev);
  }, [config]);

  const rowTestId = `${testIdPrefix}-item-${node.id}`;

  const renderContent = (): ReactNode => {
    const body =
      renderRow !== undefined
        ? renderRow({
            node,
            depth,
            isActive: config.isActive === true,
            isExpanded,
          })
        : (
            <span
              className={styles.defaultLabel}
              data-testid={`${testIdPrefix}-label-${node.id}`}
            >
              {node.label}
            </span>
          );

    if (config.droppable !== undefined) {
      return (
        <DroppableSlot
          spec={config.droppable}
          fallbackId={`${config.droppable.type}:${node.id}`}
          testId={`${testIdPrefix}-droppable-${node.id}`}
        >
          {body}
        </DroppableSlot>
      );
    }
    return body;
  };

  const sortableProps =
    config.draggable !== undefined
      ? {
          isDraggable: true as const,
          sortableId: node.id,
          sortableType: config.draggable.type,
          sortableGroup: config.draggable.group ?? "all",
          sortableIndex: config.draggable.index ?? index,
          dragHandleAriaLabel:
            config.draggable.handleAriaLabel ?? `Drag ${node.label}`,
          dragHandleTestId: `${testIdPrefix}-handle-${node.id}`,
        }
      : {};

  if (isGroup) {
    return (
      <Group
        testId={rowTestId}
        isActive={config.isActive === true}
        isExpand={isExpanded}
        onToggleExpand={toggleExpand}
        {...(config.chevronAriaLabel !== undefined
          ? { chevronAriaLabel: config.chevronAriaLabel }
          : {})}
        chevronTestId={`${testIdPrefix}-toggle-${node.id}`}
        childrenTestId={`${testIdPrefix}-children-${node.id}`}
        {...(config.onClick !== undefined ? { onClick: config.onClick } : {})}
        {...sortableProps}
        renderContent={renderContent}
      >
        {(node.children ?? []).map((child, childIndex) => (
          <EntityTreeNodeView
            key={child.id}
            node={child}
            depth={depth + 1}
            index={childIndex}
            testIdPrefix={testIdPrefix}
            rowConfig={rowConfig}
            renderRow={renderRow}
          />
        ))}
      </Group>
    );
  }

  return (
    <Row
      testId={rowTestId}
      isActive={config.isActive === true}
      {...(config.onClick !== undefined ? { onClick: config.onClick } : {})}
      {...sortableProps}
      renderContent={renderContent}
    />
  );
}

// ---------------------------------------------------------------------------
// DroppableSlot — wraps a row body in `useDroppable` so it can receive
// dragged siblings from other lists.
// ---------------------------------------------------------------------------

interface DroppableSlotProps {
  spec: EntityTreeDroppable;
  fallbackId: string;
  testId: string;
  children: ReactNode;
}

function DroppableSlot({
  spec,
  fallbackId,
  testId,
  children,
}: DroppableSlotProps): ReactElement {
  const { ref, isDropTarget } = useDroppable({
    id: spec.id ?? fallbackId,
    type: spec.type,
    accept: [...spec.accept],
  });
  return (
    <div
      ref={ref}
      className={styles.dropSlot}
      data-drop-target={isDropTarget ? "true" : undefined}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
