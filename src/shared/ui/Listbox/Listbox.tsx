import type { ReactNode } from "react";
import {
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  type ListBoxItemProps as AriaListBoxItemProps,
  type ListBoxProps as AriaListBoxProps,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Listbox.module.css";

/**
 * Selection mode forwarded to RAC.
 *
 * - `single` — one selected item (Tag picker, Role picker default).
 * - `multiple` — many selected items (Skill multi-select, prompt-tags).
 */
export type ListboxSelectionMode = "single" | "multiple";

export interface ListboxProps<T extends object>
  extends Omit<AriaListBoxProps<T>, "className" | "selectionMode"> {
  /** @default "single" */
  selectionMode?: ListboxSelectionMode;
  className?: string;
}

/**
 * `Listbox` — selectable list wrapping `react-aria-components` `ListBox`.
 *
 * RAC delivers:
 *   - role="listbox" + role="option" with aria-selected.
 *   - Roving tabindex with arrow / Home / End / typeahead.
 *   - Multiple selection via Shift + Arrow / Cmd-click.
 *   - Disabled item handling.
 *
 * Listbox needs a non-empty `aria-label` (or `aria-labelledby`) on the
 * outer element — RAC enforces this via runtime warnings; we don't try
 * to default it because the meaningful label depends on context.
 *
 * WCAG token-pair (selected item):
 * - selected text:    `--color-text-default` on `--color-accent-soft`
 *   (light: 15.3:1 → AAA; dark: 12.0:1 → AAA).
 * - hover overlay:    `--color-overlay-hover` ≥ 3:1 against canvas (UI 1.4.11).
 */
export function Listbox<T extends object>({
  selectionMode = "single",
  className,
  ...rest
}: ListboxProps<T>) {
  return (
    <AriaListBox<T>
      {...rest}
      selectionMode={selectionMode}
      className={cn(styles.listbox, className)}
    />
  );
}

export interface ListboxItemProps
  extends Omit<AriaListBoxItemProps, "className" | "children"> {
  className?: string;
  children?: ReactNode;
}

/**
 * `ListboxItem` — single option (`role="option"`).
 *
 * Pass an `id` (= unique key, e.g. tag-id or role-id) so RAC can track
 * selection across re-renders.
 */
export function ListboxItem({
  className,
  children,
  ...rest
}: ListboxItemProps) {
  return (
    <AriaListBoxItem {...rest} className={cn(styles.item, className)}>
      {children}
    </AriaListBoxItem>
  );
}
