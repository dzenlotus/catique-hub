/**
 * EntityListSidebar — generic list-rail used by /roles, /skills, /mcp-tools
 * (and any future single-entity page).
 *
 * Mirrors the shape of `<PromptsSidebar>` and `<SpacesSidebar>` so every
 * top-level page in the app shows the same rail-style nav: section
 * label on top, list of items below, "+ Add ..." trigger at the bottom.
 * Built directly on the shared `<SidebarShell>` primitives so visual
 * consistency is structural, not copy-paste.
 *
 * Items don't carry icons or kebabs by default — those affordances
 * live with whichever entity-specific row markup the consumer wires
 * up if/when needed. For now: name + optional color swatch is enough.
 */

import { type ReactElement } from "react";

import {
  SidebarAddRow,
  SidebarNavItem,
  SidebarSectionLabel,
  SidebarShell,
} from "@shared/ui";

import styles from "./EntityListSidebar.module.css";

export interface EntityListSidebarItem {
  id: string;
  name: string;
  /** Optional CSS hex; renders a small leading swatch in the row. */
  color?: string | null;
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
  /** Label on the bottom "+ Add ..." trigger. */
  addLabel: string;
  /** Click on the "+ Add ..." trigger. */
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
}: EntityListSidebarProps): ReactElement {
  return (
    <SidebarShell ariaLabel={ariaLabel} testId={`${testIdPrefix}-root`}>
      <SidebarSectionLabel ariaLabel={title}>{title}</SidebarSectionLabel>

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
            <li key={item.id} className={styles.item}>
              <SidebarNavItem
                isActive={item.id === selectedId}
                onClick={() => onSelect(item.id)}
                ariaLabel={item.name}
                testId={`${testIdPrefix}-row-${item.id}`}
              >
                {item.color ? (
                  <span
                    className={styles.swatch}
                    style={{ backgroundColor: item.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className={styles.name}>{item.name}</span>
              </SidebarNavItem>
            </li>
          ))}
        </ul>
      )}

      <SidebarAddRow
        label={addLabel}
        onPress={onAdd}
        testId={`${testIdPrefix}-add`}
      />
    </SidebarShell>
  );
}
