/**
 * EntityListSidebar — generic list-rail used by /roles, /skills, /mcp-tools
 * (and any future single-entity page).
 *
 * Mirrors the shape of `<PromptsSidebar>` and `<SpacesSidebar>` so every
 * top-level page in the app shows the same rail-style nav: section
 * label + trailing "+" trigger on top, list of items below.
 *
 * Each row renders a leading marker driven by the item:
 *   - `icon` set → `<IconRenderer>`, tinted with `color` when present.
 *   - no icon, color set → coloured swatch dot.
 *   - neither → muted placeholder swatch so the column still aligns.
 */

import { type ReactElement } from "react";

import {
  IconRenderer,
  SidebarNavItem,
  SidebarSectionAddTrigger,
  SidebarSectionLabel,
  SidebarShell,
} from "@shared/ui";

import styles from "./EntityListSidebar.module.css";

export interface EntityListSidebarItem {
  id: string;
  name: string;
  /** Optional CSS hex — tints the icon (or fills the swatch). */
  color?: string | null;
  /** Optional Pixel-icon identifier (matches `@shared/ui/Icon` keys). */
  icon?: string | null;
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
            <li key={item.id} className={styles.item}>
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
            </li>
          ))}
        </ul>
      )}

    </SidebarShell>
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
