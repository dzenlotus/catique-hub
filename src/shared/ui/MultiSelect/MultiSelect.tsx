/**
 * `MultiSelect` — chip-based multi-select primitive.
 *
 * Wraps `react-aria-components` `<ComboBox>` for the search-able
 * dropdown plus a chip rail rendered below the input. Selection model
 * is controlled — the parent owns `values` and is notified of every
 * add / remove / reorder via `onChange`.
 *
 * Behaviour contract:
 *   - Tab focuses the field; Enter / ArrowDown opens the popover.
 *   - ArrowUp / ArrowDown navigates options inside the popover.
 *   - Enter / Space toggles the focused option (here: appends to
 *     `values` since selected ids are filtered out of `filtered`).
 *   - Backspace on empty input pops the trailing chip.
 *   - Click X on a chip removes that id from `values`.
 *   - When `reorderable` is true, chips render with a drag-handle and
 *     can be reordered via `@dnd-kit/react`. `onChange` receives the
 *     full reordered list.
 */

import type { Key, ReactElement } from "react";
import {
  ComboBox as AriaComboBox,
  Input as AriaInput,
  Label as AriaLabel,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./MultiSelect.module.css";
import { MultiSelectChips } from "./MultiSelectChips";
import { useMultiSelectState } from "./useMultiSelectState";

export interface MultiSelectOption<T extends string> {
  id: T;
  name: string;
  description?: string;
}

export interface MultiSelectProps<T extends string> {
  /** Visible label (also used as the `aria-label` for the field). */
  label: string;
  /** Currently-selected ids in display order. */
  values: ReadonlyArray<T>;
  /** Pool of available items. Selected items are hidden from the dropdown. */
  options: ReadonlyArray<MultiSelectOption<T>>;
  /** Called whenever the chip set changes (add / remove / reorder). */
  onChange: (next: T[]) => void;
  /** Placeholder for the input when no chips selected. */
  placeholder?: string;
  /** Disables the field + dropdown. */
  disabled?: boolean;
  /** Rendered inside the popover when no options match the query. */
  emptyText?: string;
  /** When true a drag-handle is rendered on each chip. */
  reorderable?: boolean;
  /** Stable id for the field root and chip prefix. */
  testId?: string;
  /** Optional class merged onto the root element. */
  className?: string;
}

export function MultiSelect<T extends string>({
  label,
  values,
  options,
  onChange,
  placeholder = "Search…",
  disabled = false,
  emptyText = "No matches",
  reorderable = false,
  testId,
  className,
}: MultiSelectProps<T>): ReactElement {
  const { query, setQuery, selected, filtered, add, remove, popLast } =
    useMultiSelectState<T>({ values, options, onChange });

  const scope = testId ?? "multi-select";

  const handleSelectionChange = (key: Key | null): void => {
    if (key === null) return;
    add(key as T);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Backspace" && query === "" && values.length > 0) {
      e.preventDefault();
      popLast();
    }
  };

  return (
    <div
      className={cn(styles.root, className)}
      data-testid={scope}
    >
      <AriaComboBox
        className={styles.combobox}
        inputValue={query}
        onInputChange={setQuery}
        selectedKey={null}
        onSelectionChange={handleSelectionChange}
        menuTrigger="focus"
        allowsEmptyCollection
        isDisabled={disabled}
      >
        <AriaLabel className={styles.label}>{label}</AriaLabel>
        <div
          className={styles.fieldWrap}
          data-disabled={disabled}
          data-testid={`${scope}-field`}
        >
          <AriaInput
            className={styles.input}
            placeholder={placeholder}
            onKeyDown={handleKeyDown}
            data-testid={`${scope}-input`}
          />
        </div>
        <AriaPopover className={styles.popover}>
          <AriaListBox<MultiSelectOption<T>>
            className={styles.listbox}
            renderEmptyState={() => (
              <div className={styles.empty} data-testid={`${scope}-empty`}>
                {query.trim().length > 0
                  ? `${emptyText} for "${query.trim()}"`
                  : emptyText}
              </div>
            )}
          >
            {filtered.map((option) => (
              <AriaListBoxItem
                key={option.id}
                id={option.id}
                textValue={option.name}
                className={styles.option}
                data-testid={`${scope}-option-${option.id}`}
              >
                <span className={styles.optionLabel}>{option.name}</span>
                {option.description ? (
                  <span className={styles.optionDetail}>
                    {option.description}
                  </span>
                ) : null}
              </AriaListBoxItem>
            ))}
          </AriaListBox>
        </AriaPopover>
      </AriaComboBox>
      <MultiSelectChips<T>
        items={selected}
        onRemove={remove}
        reorderable={reorderable}
        onReorder={(nextIds) => onChange(nextIds)}
        scope={scope}
        groupId={`${scope}-chip-rail`}
      />
    </div>
  );
}
