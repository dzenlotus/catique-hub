/**
 * EntityActionMenu — shared per-entity context-menu (kebab + popover).
 *
 * Wraps the canonical `MenuTrigger` + ghost-Button + `KebabIcon` +
 * `Menu` + `MenuItem` pattern that every row-level action menu uses.
 * Pass a data-driven list of items and the component handles the
 * trigger rendering, popover wiring, and `onAction` dispatch.
 *
 *   <EntityActionMenu
 *     triggerAriaLabel="Actions for board Owner"
 *     triggerTestId="spaces-sidebar-board-kebab-..."
 *     triggerClassName={styles.boardKebab}
 *     items={[
 *       { id: "settings", label: "Settings", onAction: () => onSettings() },
 *       { id: "delete",   label: "Delete",   onAction: () => onDelete() },
 *     ]}
 *   />
 *
 * Items may carry an optional leading icon and size:
 *   { id, label, icon: <SomeIcon />, iconSize: 14, onAction }
 */

import type { ReactElement, ReactNode } from "react";

import { Button } from "../Button";
import { KebabIcon } from "../KebabIcon";
import { Menu, MenuItem, MenuTrigger } from "../Menu";

import styles from "./EntityActionMenu.module.css";

export interface EntityActionMenuItem {
  /** Stable item id — dispatched to `onAction(id)`. */
  id: string;
  /** Visible label. */
  label: string;
  /**
   * Optional leading icon. Pass any rendered ReactNode (an `<Icon/>`,
   * an `<svg/>`, etc.). The component sizes its slot to `iconSize`.
   */
  icon?: ReactNode;
  /** Square size of the icon slot in pixels. Default 14. */
  iconSize?: number;
  /** Per-item action — fires when the item is selected. */
  onAction: () => void;
}

export interface EntityActionMenuProps {
  /** Items shown in the popover, in order. Hide an item by omitting it. */
  items: ReadonlyArray<EntityActionMenuItem>;
  /** aria-label on the kebab trigger button. */
  triggerAriaLabel: string;
  /** Optional stable test-id stamped on the trigger button. */
  triggerTestId?: string;
  /**
   * Optional class merged onto the trigger button. Use when the row
   * needs its kebab to behave differently from the default ghost
   * variant — e.g. opacity-only hover treatment in a sidebar list
   * (see `SpacesSidebar.boardKebab`).
   */
  triggerClassName?: string;
}

export function EntityActionMenu({
  items,
  triggerAriaLabel,
  triggerTestId,
  triggerClassName,
}: EntityActionMenuProps): ReactElement {
  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        size="sm"
        aria-label={triggerAriaLabel}
        {...(triggerTestId !== undefined ? { "data-testid": triggerTestId } : {})}
        {...(triggerClassName !== undefined ? { className: triggerClassName } : {})}
      >
        <KebabIcon />
      </Button>
      <Menu
        onAction={(key) => {
          const item = items.find((entry) => entry.id === String(key));
          item?.onAction();
        }}
      >
        {items.map((item) => (
          <MenuItem key={item.id} id={item.id}>
            {item.icon !== undefined ? (
              <span
                className={styles.itemIcon}
                style={{
                  width: item.iconSize ?? 14,
                  height: item.iconSize ?? 14,
                }}
                aria-hidden="true"
              >
                {item.icon}
              </span>
            ) : null}
            <span className={styles.itemLabel}>{item.label}</span>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
