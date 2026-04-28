import type { ReactNode } from "react";
import {
  ComboBox as AriaComboBox,
  Input as AriaInput,
  Label as AriaLabel,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover,
  type ComboBoxProps as AriaComboBoxProps,
  type Key,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Combobox.module.css";

/**
 * Item shape consumed by `<Combobox>`. Items are passed pre-loaded; for
 * async fetching, parents own the loading and pass `items` once data is
 * ready (RAC `ComboBox` supports this idiomatically — no special API
 * needed; the consumer can compute filtered items from a query string).
 */
export interface ComboboxItem {
  id: Key;
  label: string;
  /** Optional secondary text shown muted to the right. */
  detail?: string;
  isDisabled?: boolean;
}

export interface ComboboxProps
  extends Omit<
    AriaComboBoxProps<ComboboxItem>,
    "className" | "children" | "items"
  > {
  /** Visible label (required for a11y per WCAG 3.3.2). */
  label: string;
  /** Pre-filtered items to render in the popover list. */
  items: Iterable<ComboboxItem>;
  /** Placeholder forwarded to the inner `<input>`. */
  placeholder?: string;
  /** Helper / no-results node rendered when `items` is empty. */
  emptyState?: ReactNode;
  className?: string;
}

/**
 * `Combobox` — autocomplete text-input wrapping `react-aria-components`
 * `ComboBox` + `Input` + `ListBox` + `Popover`.
 *
 * RAC delivers:
 *   - role="combobox" with aria-expanded, aria-controls, aria-activedescendant.
 *   - Open on type / down-arrow / button click; close on Esc / blur.
 *   - Built-in filter via `defaultFilter` / `inputValue` controlled flow.
 *   - Selection via Enter on focused option; commit fills the input.
 *
 * Async use: parent components debounce their query and pass an updated
 * `items` collection — RAC's `ComboBox` re-renders the popover content
 * without losing focus or open-state. No special `loadCallback` API
 * needed at this layer (we keep the surface minimal per `dependency-discipline`).
 *
 * WCAG token-pair (input + popover):
 * - input text:    `--color-text-default` on `--color-surface-raised`
 *   (light: 16.5:1 → AAA; dark: 12.6:1 → AAA).
 * - popover item:  `--color-text-default` on `--color-surface-overlay`
 *   (light: 16.5:1 → AAA; dark: 12.6:1 → AAA).
 */
export function Combobox({
  label,
  items,
  placeholder,
  emptyState,
  className,
  ...rest
}: ComboboxProps) {
  return (
    <AriaComboBox<ComboboxItem>
      {...rest}
      className={cn(styles.combobox, className)}
    >
      <AriaLabel className={styles.label}>{label}</AriaLabel>
      <div className={styles.inputWrap}>
        <AriaInput className={styles.input} placeholder={placeholder ?? ""} />
      </div>
      <Popover className={styles.popover}>
        <AriaListBox<ComboboxItem> className={styles.listbox} items={items}>
          {(item) => (
            <AriaListBoxItem
              id={item.id}
              textValue={item.label}
              isDisabled={item.isDisabled ?? false}
              className={styles.item}
            >
              <span className={styles.itemLabel}>{item.label}</span>
              {item.detail ? (
                <span className={styles.itemDetail}>{item.detail}</span>
              ) : null}
            </AriaListBoxItem>
          )}
        </AriaListBox>
        {emptyState ? <div className={styles.empty}>{emptyState}</div> : null}
      </Popover>
    </AriaComboBox>
  );
}
