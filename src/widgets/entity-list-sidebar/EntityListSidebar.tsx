/**
 * EntityListSidebar — generic list-rail used by /roles, /skills,
 * /mcp-servers (and any future single-entity page).
 *
 * Mirrors the shape of `<PromptsSidebar>` and `<SpacesSidebar>` so every
 * top-level page in the app shows the same rail-style nav: section
 * label + trailing "+" trigger on top, list of items below.
 *
 * Each row renders a leading marker driven by the item:
 *   - `icon` set → `<IconRenderer>`, tinted with `color` when present.
 *   - no icon, color set → coloured swatch dot.
 *   - neither → muted placeholder swatch so the column still aligns.
 *
 * Round-22: nested-children variant — items can carry a `children`
 * array. When present a leading chevron is rendered; clicking the
 * chevron toggles the parent's expansion state without changing the
 * selection. Children render indented underneath the parent only when
 * `expandedIds` includes that parent id. Mirrors the chevron toggle
 * pattern from `widgets/spaces-sidebar` (space → board nesting) so the
 * two rails read as one family.
 */

import { type ReactElement } from "react";

import {
  IconRenderer,
  SidebarNavItem,
  SidebarSectionAddTrigger,
  SidebarSectionLabel,
  SidebarShell,
} from "@shared/ui";

import { EntityListSidebarChevron } from "./EntityListSidebarChevron";
import styles from "./EntityListSidebar.module.css";

export interface EntityListSidebarItem {
  id: string;
  name: string;
  /** Optional CSS hex — tints the icon (or fills the swatch). */
  color?: string | null;
  /** Optional Pixel-icon identifier (matches `@shared/ui/Icon` keys). */
  icon?: string | null;
  /**
   * Optional nested rows rendered indented underneath this item. When
   * non-empty the parent row gets a leading disclosure chevron; the
   * children only mount when the parent id appears in `expandedIds`.
   */
  children?: ReadonlyArray<EntityListSidebarItem>;
}

export interface EntityListSidebarProps {
  /** Uppercase section label (e.g. "AGENT ROLES"). */
  title: string;
  /** Pre-loaded item list. */
  items: ReadonlyArray<EntityListSidebarItem>;
  /** Currently-selected item id (drives the active highlight). */
  selectedId?: string | null;
  /** Click on a row. */
  onSelect: (id: string) => void;
  /** Aria-label on the trailing "+" icon trigger (e.g. "Add role"). */
  addLabel: string;
  /** Click on the "+" trigger that sits next to the section label. */
  onAdd: () => void;
  /** Empty-state copy when `items.length === 0`. */
  emptyText?: string;
  /** Aria label on the `<aside>` root. */
  ariaLabel: string;
  /** Stable id-prefix for `data-testid` attributes. */
  testIdPrefix: string;
  /** Loading variant (skeleton text in the body). */
  isLoading?: boolean;
  /** Error message; renders inline in the body when present. */
  errorMessage?: string | null;
  /**
   * Controlled list of parent ids whose `children` are currently
   * expanded. Required when any item supplies `children`. Owners hold
   * this state alongside selection (same pattern as spaces-sidebar's
   * per-space expanded flag).
   */
  expandedIds?: ReadonlyArray<string>;
  /**
   * Toggle handler for the leading chevron on items with `children`.
   * Required when any item supplies `children`.
   */
  onToggleExpand?: (id: string) => void;
}

export function EntityListSidebar({
  title,
  items,
  selectedId = null,
  onSelect,
  addLabel,
  onAdd,
  emptyText = "Nothing here yet.",
  ariaLabel,
  testIdPrefix,
  isLoading = false,
  errorMessage = null,
  expandedIds,
  onToggleExpand,
}: EntityListSidebarProps): ReactElement {
  const expandedSet = new Set(expandedIds ?? []);

  return (
    <SidebarShell ariaLabel={ariaLabel} testId={`${testIdPrefix}-root`}>
      <SidebarSectionLabel
        ariaLabel={title}
        trailing={
          <SidebarSectionAddTrigger
            ariaLabel={addLabel}
            onPress={onAdd}
            testId={`${testIdPrefix}-add`}
          />
        }
      >
        {title}
      </SidebarSectionLabel>

      {isLoading ? (
        <div className={styles.bodyEmpty} aria-hidden="true">
          <span className={styles.bodyEmptyText}>Loading…</span>
        </div>
      ) : errorMessage ? (
        <div className={styles.bodyError} role="alert">
          {errorMessage}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.bodyEmpty}>
          <span className={styles.bodyEmptyText}>{emptyText}</span>
        </div>
      ) : (
        <ul className={styles.list} role="list">
          {items.map((item) => (
            <EntityListSidebarRow
              key={item.id}
              item={item}
              selectedId={selectedId}
              onSelect={onSelect}
              testIdPrefix={testIdPrefix}
              expandedSet={expandedSet}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </ul>
      )}

    </SidebarShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface EntityListSidebarRowProps {
  item: EntityListSidebarItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
  testIdPrefix: string;
  expandedSet: ReadonlySet<string>;
  /**
   * Always present in JSX even when the parent supplied `undefined` —
   * typed as `| undefined` so `exactOptionalPropertyTypes` accepts the
   * forwarded prop without `?`-narrowing the call site.
   */
  onToggleExpand: ((id: string) => void) | undefined;
}

function EntityListSidebarRow({
  item,
  selectedId,
  onSelect,
  testIdPrefix,
  expandedSet,
  onToggleExpand,
}: EntityListSidebarRowProps): ReactElement {
  // Presence of the `children` array — even when empty — opts the row
  // into the expandable variant. Owners pass an empty list when the
  // tools haven't been fetched yet so the chevron always renders and
  // the user can drill down before introspection lands.
  const isExpandable = item.children !== undefined;
  const isExpanded = isExpandable && expandedSet.has(item.id);

  return (
    <li className={styles.item}>
      <div className={styles.row}>
        {isExpandable ? (
          <button
            type="button"
            className={styles.chevronBtn}
            onClick={() => onToggleExpand?.(item.id)}
            aria-label={
              isExpanded ? `Collapse ${item.name}` : `Expand ${item.name}`
            }
            aria-expanded={isExpanded}
            data-testid={`${testIdPrefix}-toggle-${item.id}`}
          >
            <EntityListSidebarChevron open={isExpanded} />
          </button>
        ) : (
          <span className={styles.chevronSpacer} aria-hidden="true" />
        )}
        <div className={styles.rowMain}>
          <SidebarNavItem
            isActive={item.id === selectedId}
            onClick={() => onSelect(item.id)}
            ariaLabel={item.name}
            testId={`${testIdPrefix}-row-${item.id}`}
          >
            <ItemMarker
              icon={item.icon ?? null}
              color={item.color ?? null}
            />
            <span className={styles.name}>{item.name}</span>
          </SidebarNavItem>
        </div>
      </div>

      {isExpanded && item.children ? (
        <ul
          className={styles.children}
          role="list"
          data-testid={`${testIdPrefix}-children-${item.id}`}
        >
          {item.children.map((child) => (
            <li key={child.id} className={styles.childItem}>
              <SidebarNavItem
                isActive={child.id === selectedId}
                onClick={() => onSelect(child.id)}
                ariaLabel={child.name}
                level={1}
                testId={`${testIdPrefix}-row-${child.id}`}
              >
                <ItemMarker
                  icon={child.icon ?? null}
                  color={child.color ?? null}
                />
                <span className={styles.name}>{child.name}</span>
              </SidebarNavItem>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface ItemMarkerProps {
  icon: string | null;
  color: string | null;
}

function ItemMarker({ icon, color }: ItemMarkerProps): ReactElement {
  if (icon) {
    return (
      <IconRenderer
        name={icon}
        width={14}
        height={14}
        className={styles.icon}
        {...(color !== null ? { style: { color } } : {})}
      />
    );
  }
  return (
    <span
      className={styles.swatch}
      style={
        color !== null
          ? ({ backgroundColor: color } as React.CSSProperties)
          : undefined
      }
      aria-hidden="true"
    />
  );
}
