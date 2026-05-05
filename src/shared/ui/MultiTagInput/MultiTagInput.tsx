/**
 * MultiTagInput — react-aria multi-select tag-input primitive.
 *
 * Standard tags-input pattern using `<TagGroup>` for the chip row +
 * `<ComboBox>` for the autocomplete input. Selected items render as
 * chips above the input with an in-pill `×` to detach. Typing filters
 * the dropdown live; Enter on a focused option attaches it; if the
 * query doesn't match any item, a "Create '<query>'" row appears that
 * fires the `onCreate` callback.
 *
 * Controlled — parent owns `selectedIds`, fires `onChange(next)` on
 * any add/remove. Items are passed pre-loaded; the parent decides
 * what populates the dropdown.
 */

import { useEffect, useState, type ReactElement } from "react";
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  Input as AriaInput,
  Label as AriaLabel,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
  Tag as AriaTag,
  TagGroup as AriaTagGroup,
  TagList as AriaTagList,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./MultiTagInput.module.css";

export interface MultiTagInputItem {
  /** Stable id used in the selected set + dropdown keys. */
  id: string;
  /** Visible label inside the chip + dropdown row. */
  label: string;
  /** Optional CSS hex; renders a small swatch in the chip. */
  color?: string | null;
}

export interface MultiTagInputProps {
  /** A11y label for the input. */
  label: string;
  /** Every item that could appear in the dropdown. */
  items: ReadonlyArray<MultiTagInputItem>;
  /** Currently-selected ids. */
  selectedIds: ReadonlyArray<string>;
  /** Called when the user adds or removes a chip. */
  onChange: (next: ReadonlyArray<string>) => void;
  /**
   * Called when the user picks the "Create '<query>'" row. Receives
   * the trimmed query string. If absent, the create row is hidden
   * (read-only mode).
   */
  onCreate?: (name: string) => void;
  /** Placeholder for the input when no chips selected. */
  placeholder?: string;
  /** Stable id for the field root. */
  "data-testid"?: string;
}

const CREATE_KEY = "__create__";

export function MultiTagInput({
  label,
  items,
  selectedIds,
  onChange,
  onCreate,
  placeholder = "Add…",
  "data-testid": testId,
}: MultiTagInputProps): ReactElement {
  const [query, setQuery] = useState("");

  // RAC ComboBox echoes the selected option's text into the input
  // value right before our onSelectionChange handler runs. This effect
  // wipes that echo on the next render once the chip has landed in
  // selectedIds, so the input visibly empties after a click.
  useEffect(() => {
    setQuery("");
  }, [selectedIds.length]);

  const itemById = new Map(items.map((it) => [it.id, it]));
  const selectedItems = selectedIds
    .map((id) => itemById.get(id))
    .filter((it): it is MultiTagInputItem => it !== undefined);

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const filtered = items.filter((it) => {
    if (selectedIds.includes(it.id)) return false;
    if (lower.length === 0) return true;
    return it.label.toLowerCase().includes(lower);
  });

  const exactMatch = items.some(
    (it) => it.label.toLowerCase() === lower,
  );
  const showCreate =
    onCreate !== undefined && trimmed.length > 0 && !exactMatch;

  const handleSelectFromList = (key: React.Key | null): void => {
    if (key === null) return;
    if (key === CREATE_KEY) {
      onCreate?.(trimmed);
      setQuery("");
      return;
    }
    if (typeof key !== "string") return;
    if (selectedIds.includes(key)) return;
    onChange([...selectedIds, key]);
    setQuery("");
  };

  const handleRemove = (keys: Set<React.Key>): void => {
    const removed = new Set([...keys].map((k) => String(k)));
    onChange(selectedIds.filter((id) => !removed.has(id)));
  };

  return (
    <div className={styles.root} data-testid={testId}>
      <AriaComboBox
        className={styles.combobox}
        inputValue={query}
        onInputChange={setQuery}
        selectedKey={null}
        onSelectionChange={handleSelectFromList}
        menuTrigger="focus"
        allowsEmptyCollection
      >
        <AriaLabel className={styles.srOnly}>{label}</AriaLabel>
        <div className={styles.inputWrap}>
          {selectedItems.length > 0 ? (
            <AriaTagGroup
              className={styles.tagGroup}
              aria-label={`${label} — selected`}
              selectionMode="none"
              onRemove={handleRemove}
            >
              <AriaTagList className={styles.tagList}>
                {selectedItems.map((item) => (
                  <AriaTag
                    key={item.id}
                    id={item.id}
                    textValue={item.label}
                    className={styles.tag}
                  >
                    {item.color ? (
                      <span
                        className={styles.tagSwatch}
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className={styles.tagLabel}>{item.label}</span>
                    <AriaButton
                      slot="remove"
                      className={styles.tagRemove}
                      aria-label={`Remove ${item.label}`}
                    >
                      <span aria-hidden="true">×</span>
                    </AriaButton>
                  </AriaTag>
                ))}
              </AriaTagList>
            </AriaTagGroup>
          ) : null}
          <AriaInput
            className={styles.input}
            placeholder={selectedItems.length === 0 ? placeholder : ""}
          />
        </div>
        <AriaPopover className={styles.popover}>
          <AriaListBox<MultiTagInputItem | { id: string; label: string }>
            className={styles.listbox}
            renderEmptyState={() => (
              <div className={styles.empty}>
                {trimmed.length > 0
                  ? `No matches for "${trimmed}"`
                  : "Start typing to search…"}
              </div>
            )}
          >
            {filtered.map((item) => (
              <AriaListBoxItem
                key={item.id}
                id={item.id}
                textValue={item.label}
                className={cn(styles.option)}
              >
                {item.color ? (
                  <span
                    className={styles.optionSwatch}
                    style={{ backgroundColor: item.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className={styles.optionLabel}>{item.label}</span>
              </AriaListBoxItem>
            ))}
            {showCreate ? (
              <AriaListBoxItem
                key={CREATE_KEY}
                id={CREATE_KEY}
                textValue={`Create ${trimmed}`}
                className={cn(styles.option, styles.optionCreate)}
              >
                <span className={styles.optionPlus} aria-hidden="true">
                  +
                </span>
                <span className={styles.optionLabel}>
                  Create &ldquo;{trimmed}&rdquo;
                </span>
              </AriaListBoxItem>
            ) : null}
          </AriaListBox>
        </AriaPopover>
      </AriaComboBox>
    </div>
  );
}
