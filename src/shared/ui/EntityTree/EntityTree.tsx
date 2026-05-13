/**
 * EntityTree — unified tree-list primitive consumed by every page-level
 * secondary rail. Extracted from the SpacesSidebar pattern (Round 20) so
 * Roles / Skills / MCP servers / Prompts read as one family.
 *
 * Layout contract (matches `SpacesSidebar` + `SidebarNavItem`):
 *   - Row column 1 = 16 px chevron (or spacer for leaves).
 *   - Row column 2 = `SidebarNavItem` containing leading visual + label
 *     (+ optional badge). Active highlight + leading red strip come from
 *     `SidebarNavItem` — no new active-row styles introduced here.
 *   - `trailingNode` slot is rendered as a sibling of the nav-item so it
 *     shares the row's hover/active background without re-triggering the
 *     button onClick.
 *
 * Expansion is controlled. Persistence (e.g. localStorage flags) is the
 * caller's concern — `useEntityTreeExpandedStorage` (separate hook) wraps
 * the common case if you want it.
 */

import { useCallback, type ReactElement, type ReactNode } from "react";

import { cn } from "@shared/lib";
import {
  IconRenderer,
  MarqueeText,
  SidebarNavItem,
  SidebarSectionAddTrigger,
  SidebarSectionLabel,
  SidebarShell,
} from "@shared/ui";

import { EntityTreeChevron } from "./EntityTreeChevron";
import styles from "./EntityTree.module.css";
import type {
  EntityTreeNode,
  EntityTreeProps,
  EntityTreeRenderRowArgs,
} from "./types";

export function EntityTree<TMeta = unknown>(
  props: EntityTreeProps<TMeta>,
): ReactElement {
  const {
    title,
    ariaLabel,
    nodes,
    selectedId = null,
    expandedIds,
    onToggleExpand,
    onSelect,
    addLabel,
    onAdd,
    emptyText = "Nothing here yet.",
    isLoading = false,
    errorMessage = null,
    testIdPrefix,
    renderRow,
  } = props;

  const expandedSet = new Set(expandedIds);
  // Mirrors `SpacesSidebar` — show the "+" trigger only when the body
  // has loaded successfully so a half-rendered rail can't fire a
  // create dialog against undefined state.
  const showAdd =
    onAdd !== undefined && !isLoading && errorMessage === null;

  return (
    <SidebarShell
      {...(ariaLabel !== undefined ? { ariaLabel } : { ariaLabel: title ?? "Entity tree" })}
      testId={`${testIdPrefix}-root`}
    >
      {title !== undefined ? (
        <SidebarSectionLabel
          ariaLabel={title}
          trailing={
            showAdd ? (
              <SidebarSectionAddTrigger
                ariaLabel={addLabel ?? `Add ${title.toLowerCase()}`}
                onPress={onAdd}
                testId={`${testIdPrefix}-add`}
              />
            ) : null
          }
        >
          {title}
        </SidebarSectionLabel>
      ) : null}

      {isLoading ? (
        <div className={styles.bodyEmpty} aria-hidden="true">
          <span className={styles.bodyEmptyText}>Loading…</span>
        </div>
      ) : errorMessage !== null ? (
        <div className={styles.bodyError} role="alert">
          {errorMessage}
        </div>
      ) : nodes.length === 0 ? (
        <div className={styles.bodyEmpty}>
          <span className={styles.bodyEmptyText}>{emptyText}</span>
        </div>
      ) : (
        <ul className={styles.list} role="list">
          {nodes.map((node) => (
            <EntityTreeRow
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              expandedSet={expandedSet}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              testIdPrefix={testIdPrefix}
              renderRow={renderRow}
            />
          ))}
        </ul>
      )}
    </SidebarShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface EntityTreeRowProps<TMeta> {
  node: EntityTreeNode<TMeta>;
  depth: number;
  selectedId: string | null;
  expandedSet: ReadonlySet<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string, node: EntityTreeNode<TMeta>) => void;
  testIdPrefix: string;
  renderRow: ((args: EntityTreeRenderRowArgs<TMeta>) => ReactNode) | undefined;
}

function EntityTreeRow<TMeta>({
  node,
  depth,
  selectedId,
  expandedSet,
  onToggleExpand,
  onSelect,
  testIdPrefix,
  renderRow,
}: EntityTreeRowProps<TMeta>): ReactElement {
  const isExpandable = node.children !== undefined;
  const isExpanded = isExpandable && expandedSet.has(node.id);
  const isSelected = node.id === selectedId;
  const isDisabled = node.isDisabled === true;

  // Stable handles for the escape-hatch render prop. Wrapped in
  // `useCallback` so callers can memoise the children they render with
  // them without tearing through identity churn on every parent render.
  const toggleExpand = useCallback((): void => {
    if (!isExpandable || isDisabled) return;
    onToggleExpand(node.id);
  }, [isExpandable, isDisabled, onToggleExpand, node.id]);

  const select = useCallback((): void => {
    if (isDisabled) return;
    onSelect(node.id, node);
  }, [isDisabled, onSelect, node]);

  return (
    <li
      className={cn(styles.item, isDisabled && styles.itemDisabled)}
      data-testid={`${testIdPrefix}-item-${node.id}`}
    >
      <div
        className={styles.row}
        style={depth > 0 ? { paddingLeft: `calc(var(--space-12) * ${depth})` } : undefined}
      >
        {isExpandable ? (
          <button
            type="button"
            className={styles.chevronBtn}
            onClick={toggleExpand}
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
            aria-expanded={isExpanded}
            disabled={isDisabled}
            data-testid={`${testIdPrefix}-toggle-${node.id}`}
          >
            <EntityTreeChevron open={isExpanded} />
          </button>
        ) : (
          <span className={styles.chevronSpacer} aria-hidden="true" />
        )}

        <div className={styles.rowMain}>
          {renderRow !== undefined ? (
            renderRow({
              node,
              depth,
              isExpanded,
              isSelected,
              toggleExpand,
              select,
            })
          ) : (
            <EntityTreeDefaultBody
              node={node}
              isSelected={isSelected}
              isDisabled={isDisabled}
              select={select}
              testIdPrefix={testIdPrefix}
            />
          )}
        </div>
      </div>

      {isExpanded && node.children !== undefined && node.children.length > 0 ? (
        <ul
          className={styles.children}
          role="list"
          data-testid={`${testIdPrefix}-children-${node.id}`}
        >
          {node.children.map((child) => (
            <EntityTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedSet={expandedSet}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              testIdPrefix={testIdPrefix}
              renderRow={renderRow}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface EntityTreeDefaultBodyProps<TMeta> {
  node: EntityTreeNode<TMeta>;
  isSelected: boolean;
  isDisabled: boolean;
  select: () => void;
  testIdPrefix: string;
}

/**
 * Declarative row body used when the caller doesn't supply `renderRow`.
 * Lays out leading visual + label (+ inline badge) inside a
 * `SidebarNavItem`; the optional `trailingNode` slot rides alongside as a
 * sibling so it shares the active-row background without doubling the
 * onClick.
 */
function EntityTreeDefaultBody<TMeta>({
  node,
  isSelected,
  isDisabled,
  select,
  testIdPrefix,
}: EntityTreeDefaultBodyProps<TMeta>): ReactElement {
  const labelClass = cn(
    styles.label,
    node.strikethrough === true && styles.labelStrikethrough,
  );
  // `SidebarNavItem` requires onClick to be `() => void` (no
  // `undefined` accepted under exactOptionalPropertyTypes). Spread
  // conditionally so disabled rows opt out of the activation surface
  // entirely — clicks still no-op via the row-level guard, but the
  // button reads as inert to AT.
  const navItemProps = {
    isActive: isSelected,
    ariaLabel: node.label,
    testId: `${testIdPrefix}-row-${node.id}`,
    ...(isDisabled ? {} : { onClick: select }),
    ...(node.trailingNode !== undefined ? { trailing: node.trailingNode } : {}),
  };
  return (
    <SidebarNavItem {...navItemProps}>
      <EntityTreeLeading node={node} />
      <span className={styles.labelWrap}>
        <MarqueeText text={node.label} className={labelClass} />
        {node.badge !== undefined ? (
          <span className={styles.badge} aria-hidden="true">
            {node.badge}
          </span>
        ) : null}
      </span>
      {node.subtitle !== undefined ? (
        <span className={styles.subtitle}>{node.subtitle}</span>
      ) : null}
    </SidebarNavItem>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface EntityTreeLeadingProps<TMeta> {
  node: EntityTreeNode<TMeta>;
}

function EntityTreeLeading<TMeta>({
  node,
}: EntityTreeLeadingProps<TMeta>): ReactElement | null {
  if (node.leadingNode !== undefined) return <>{node.leadingNode}</>;
  if (node.leadingIcon !== undefined) {
    return (
      <IconRenderer
        name={node.leadingIcon}
        width={14}
        height={14}
        className={styles.icon}
        {...(node.leadingColor != null
          ? { style: { color: node.leadingColor } }
          : {})}
      />
    );
  }
  if (node.leadingColor != null) {
    return (
      <span
        className={styles.swatch}
        style={{ backgroundColor: node.leadingColor }}
        aria-hidden="true"
      />
    );
  }
  return null;
}
