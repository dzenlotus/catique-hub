import type { ReactNode } from "react";
import {
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger as AriaMenuTrigger,
  Popover,
  Separator as AriaSeparator,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  type MenuTriggerProps as AriaMenuTriggerProps,
  type SeparatorProps as AriaSeparatorProps,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Menu.module.css";

export type MenuTriggerProps = AriaMenuTriggerProps;

/**
 * `MenuTrigger` — RAC re-export, ergonomic wiring for an anchor + menu.
 *
 * Usage:
 *   <MenuTrigger>
 *     <Button>Actions</Button>
 *     <Menu>
 *       <MenuItem id="rename">Rename</MenuItem>
 *       <Separator />
 *       <MenuItem id="delete">Delete</MenuItem>
 *     </Menu>
 *   </MenuTrigger>
 *
 * RAC matches trigger and menu by sibling-position; no IDs required.
 */
export const MenuTrigger = AriaMenuTrigger;

export interface MenuProps<T extends object>
  extends Omit<AriaMenuProps<T>, "className"> {
  className?: string;
  /**
   * Where the popover should anchor relative to the trigger.
   * @default "bottom start"
   */
  placement?: "bottom start" | "bottom end" | "top start" | "top end";
}

/**
 * `Menu` — RAC `Menu` wrapped in a `Popover` so it's positioned via
 * react-aria's overlay system (uses `@floating-ui` under the hood).
 *
 * Behaviour delivered by RAC:
 *   - role="menu" + role="menuitem" with aria-orientation="vertical".
 *   - Roving tabindex with Up/Down, Home/End, Esc closes, Enter activates.
 *   - Typeahead (typing letters jumps to matching item).
 *   - Auto-close on item activation.
 *   - Focus restored to trigger on close.
 *
 * WCAG token-pair (menu item):
 * - text:    `--color-text-default` on `--color-surface-overlay`
 *   (light: 16.5:1 → AAA; dark: 12.6:1 → AAA).
 * - hover:   `--color-overlay-hover` ≥ 3:1 against panel (UI 1.4.11).
 */
export function Menu<T extends object>({
  className,
  placement = "bottom start",
  ...rest
}: MenuProps<T>) {
  return (
    <Popover className={styles.popover} placement={placement}>
      <AriaMenu<T> {...rest} className={cn(styles.menu, className)} />
    </Popover>
  );
}

export interface MenuItemProps
  extends Omit<AriaMenuItemProps, "className" | "children"> {
  className?: string;
  children?: ReactNode;
  /** Visual emphasis. `danger` for destructive actions (red text). */
  variant?: "default" | "danger";
}

/** `MenuItem` — single command (`role="menuitem"`). */
export function MenuItem({
  className,
  children,
  variant = "default",
  ...rest
}: MenuItemProps) {
  return (
    <AriaMenuItem
      {...rest}
      className={cn(
        styles.item,
        variant === "danger" && styles.itemDanger,
        className,
      )}
    >
      {children}
    </AriaMenuItem>
  );
}

export interface MenuSeparatorProps
  extends Omit<AriaSeparatorProps, "className"> {
  className?: string;
}

/** `Separator` — visual + a11y divider (`role="separator"`). */
export function Separator({ className, ...rest }: MenuSeparatorProps) {
  return (
    <AriaSeparator {...rest} className={cn(styles.separator, className)} />
  );
}
