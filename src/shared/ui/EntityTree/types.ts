/**
 * Public types for `EntityTree` — declarative tree-list primitive used by
 * every page-level secondary rail (Roles, Skills, MCP servers, …).
 *
 * The shape mirrors the SpacesSidebar pattern: each node is a row, nesting
 * is `children`-driven, the chevron column always exists so leaf and
 * expandable rows align horizontally. Slots (`leadingIcon`,
 * `leadingColor`, `leadingNode`, `trailingNode`, `badge`) cover the common
 * 90 % of layouts; pages with bespoke needs (e.g. inline kebab menus,
 * status dots wired to query state) opt out via `renderRow`.
 *
 * Generic `TMeta` lets callers thread extra context to their click /
 * select handlers without monkey-patching the node — common uses:
 *   - the underlying entity object,
 *   - a discriminator for namespaced ids (`srv:` vs `tool:`),
 *   - a token-count number for trailing-slot rendering.
 */

import type { ReactNode } from "react";

export interface EntityTreeNode<TMeta = unknown> {
  /** Stable id across renders. Used for selection + expansion keys. */
  id: string;
  /** Primary text rendered with `<MarqueeText>`. */
  label: string;
  /** Optional secondary line (1 line, dimmer color, ellipsis). */
  subtitle?: string;
  /**
   * Leading visual. Slots are evaluated in order:
   *   1. `leadingNode` if defined — overrides the rest.
   *   2. `leadingIcon` — resolved via `IconRenderer`; tinted by `leadingColor`.
   *   3. `leadingColor` alone — fills a small swatch.
   *   4. None — chevron column still gets its spacer; leading visual omitted.
   */
  leadingIcon?: string;
  leadingColor?: string | null;
  leadingNode?: ReactNode;
  /** Trailing slot — count chip, status dot, menu, action buttons. */
  trailingNode?: ReactNode;
  /** Inline badge after the label (e.g. "(3)" or "draft"). */
  badge?: ReactNode;
  /** Per-node metadata threaded back to `onSelect`. */
  meta?: TMeta;
  /**
   * Nested children. Absent = leaf, present (even empty array) =
   * expandable. Empty list still renders a chevron so the rail
   * acknowledges the row can expand once data lands.
   */
  children?: ReadonlyArray<EntityTreeNode<TMeta>>;
  /** Disabled state (opacity, no hover bg, click suppressed). */
  isDisabled?: boolean;
  /** Strike-through label (e.g. soft-deleted entity). */
  strikethrough?: boolean;
}

export interface EntityTreeRenderRowArgs<TMeta = unknown> {
  node: EntityTreeNode<TMeta>;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  toggleExpand: () => void;
  select: () => void;
}

export interface EntityTreeProps<TMeta = unknown> {
  /** Section header label rendered uppercase via SidebarSectionLabel. */
  title?: string;
  /** Optional aria-label for the entire list. */
  ariaLabel?: string;
  /** Tree data — top-level nodes. */
  nodes: ReadonlyArray<EntityTreeNode<TMeta>>;
  /**
   * Currently-selected node id (drives active highlight; matches any
   * depth). Pinned / persistent-active styling is the caller's concern.
   */
  selectedId?: string | null;
  /** Controlled expanded ids — presence in the set = expanded. */
  expandedIds: ReadonlyArray<string>;
  /** Toggle a node's expanded state (caller updates `expandedIds`). */
  onToggleExpand: (id: string) => void;
  /** Click on the row body — navigate / select. */
  onSelect: (id: string, node: EntityTreeNode<TMeta>) => void;
  /** Optional "+" trigger next to the section label. */
  addLabel?: string;
  onAdd?: () => void;
  /** Empty-state copy when `nodes.length === 0`. */
  emptyText?: string;
  /** Pending state — render a skeleton instead of nodes. */
  isLoading?: boolean;
  /** Error message — render an alert instead of nodes. */
  errorMessage?: string | null;
  /** Stable testid prefix; rows get `${prefix}-row-${node.id}`. */
  testIdPrefix: string;
  /**
   * Render-prop escape hatch. When provided takes precedence over the
   * declarative slots. Use when the row needs a fully-custom layout
   * (e.g. inline kebab + child cards inline).
   */
  renderRow?: (args: EntityTreeRenderRowArgs<TMeta>) => ReactNode;
}
