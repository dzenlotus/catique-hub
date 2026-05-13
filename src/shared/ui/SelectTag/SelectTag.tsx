/**
 * SelectTag — tags-inside-the-field multi-select primitive.
 *
 * Mirrors the chip-in-field pattern from `MultiTagInput` (chips and the
 * search input share one bordered surface) and adds:
 *   - toggle-off via a clicking-an-already-selected option (with a `✓` mark);
 *   - optional clear-all `×` button before the dropdown chevron;
 *   - optional `+N` overflow when `maxVisibleChips > 0`;
 *   - paste-split on `[,;\n]` resolving fragments against `options`;
 *   - loading / error / disabled / readOnly states;
 *   - optional `reorderable` chips powered by `@dnd-kit/react` (parity
 *     with `<MultiSelect reorderable>` — drop emits the full reordered
 *     id list via `onChange`).
 *
 * Composition: RAC `<ComboBox>` (input + popover) + `<TagGroup>` (chip row)
 * sharing a single visual surface. The `+N` counter affordance uses a
 * RAC `<DialogTrigger>` + `<Popover>` (click-to-open), not `<Tooltip>` —
 * decision: a click-popover is keyboard- and touch-accessible; hover-only
 * tooltips violate WCAG 1.4.13 unless a non-hover path is provided.
 * Documenting here so a future contributor doesn't flip it without
 * acknowledging the a11y cost.
 *
 * Mobile follow-up: this iteration does NOT convert the popover into a
 * bottom-sheet. Field width still expands; popover stays anchored. Track
 * the bottom-sheet variant separately once a design spec lands.
 *
 * The component is fully controlled — parent owns `values` and is the
 * sole source of truth. We never mutate `values` internally; every add /
 * remove / clear / create / paste emits exactly one `onChange` call with
 * the next list.
 */

import {
  useEffect,
  useMemo,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ComboBox as AriaComboBox,
  Input as AriaInput,
  Label as AriaLabel,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
} from "react-aria-components";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";

import { cn } from "@shared/lib";

import styles from "./SelectTag.module.css";

const CREATE_KEY = "__select_tag_create__";

export interface SelectTagOption {
  /** Stable id used in the selected set + dropdown keys. */
  id: string;
  /** Visible label inside the chip + dropdown row. */
  label: string;
  /** Optional hex; renders a small swatch in the chip + dropdown row. */
  color?: string | null;
  /** Optional muted secondary text in the dropdown row. */
  description?: string;
}

export interface SelectTagProps {
  /** Visible label rendered above the field. Required for a11y. */
  label: string;
  /** All possible options to render in the dropdown. */
  options: ReadonlyArray<SelectTagOption>;
  /** Currently-selected option ids, in selection order. */
  values: ReadonlyArray<string>;
  /** Fires whenever the selection changes (add / remove / clear / create / paste). */
  onChange: (next: ReadonlyArray<string>) => void;
  /**
   * If supplied, the empty-results state shows a "Create '<query>'" row
   * that fires this callback with the trimmed query. Implementations
   * decide whether the new id becomes a chip immediately (typical) or
   * waits for the parent's async create-then-onChange flow.
   */
  onCreate?: (name: string) => void;
  /** Placeholder for the search input when no chips selected. */
  placeholder?: string;
  /** Description text below the field (muted). */
  description?: string;
  /** Error message — when non-empty, applies error styling + replaces description. */
  errorMessage?: string;
  /** Disables every interaction; chips render muted. */
  disabled?: boolean;
  /** Read-only: chips visible, no chip-× / popover / input / clear. */
  readOnly?: boolean;
  /** Renders a loading placeholder inside the popover ("Loading…"). */
  isLoading?: boolean;
  /** Show a single clear-all button when at least one value selected. Default: false. */
  isClearable?: boolean;
  /**
   * Max chips rendered in the field before collapsing the remainder
   * into a `+N` counter chip. The counter chip exposes a tooltip /
   * popover-on-click listing the hidden labels. `0` = no collapse
   * (wrap freely). Default: 0.
   */
  maxVisibleChips?: number;
  /**
   * Allow pasting comma / semicolon / newline-separated strings to be
   * split into multiple values. Each fragment is resolved against
   * `options` (case-insensitive label match → id), or — when `onCreate`
   * is supplied — turned into a create call. Unresolved fragments are
   * dropped silently. Default: false.
   */
  splitOnPaste?: boolean;
  /**
   * When true, each visible chip renders a leading drag-handle and the
   * chip row becomes drag-reorderable via `@dnd-kit/react`. The full
   * reordered id list is emitted via `onChange` on drop. Mirrors the
   * UX in `<MultiSelect reorderable>`. Default: false.
   *
   * Note: reorder is restricted to the *visible* chips (those rendered
   * before the `+N` overflow). Hidden chips keep their tail position.
   */
  reorderable?: boolean;
  /** Stable test id forwarded to the field root + chip prefix. */
  "data-testid"?: string;
  /** Class merged onto the field root. */
  className?: string;
}

interface VisibilityPlan {
  visible: ReadonlyArray<SelectTagOption>;
  hidden: ReadonlyArray<SelectTagOption>;
}

function computeVisibility(
  selectedOptions: ReadonlyArray<SelectTagOption>,
  maxVisibleChips: number,
): VisibilityPlan {
  if (maxVisibleChips <= 0 || selectedOptions.length <= maxVisibleChips) {
    return { visible: selectedOptions, hidden: [] };
  }
  return {
    visible: selectedOptions.slice(0, maxVisibleChips),
    hidden: selectedOptions.slice(maxVisibleChips),
  };
}

export function SelectTag({
  label,
  options,
  values,
  onChange,
  onCreate,
  placeholder = "Search…",
  description,
  errorMessage,
  disabled = false,
  readOnly = false,
  isLoading = false,
  isClearable = false,
  maxVisibleChips = 0,
  splitOnPaste = false,
  reorderable = false,
  "data-testid": testId,
  className,
}: SelectTagProps): ReactElement {
  const [query, setQuery] = useState("");
  const scope = testId ?? "select-tag";
  const valuesLength = values.length;
  const hasError = Boolean(errorMessage);
  const isInteractive = !disabled && !readOnly;

  // Clear the input every time the selection-length changes (parity with
  // MultiTagInput — RAC's ComboBox echoes the picked option's text into
  // the input value just before our handler runs).
  useEffect(() => {
    setQuery("");
  }, [valuesLength]);

  const optionById = useMemo(() => {
    const map = new Map<string, SelectTagOption>();
    for (const o of options) map.set(o.id, o);
    return map;
  }, [options]);

  const optionByLabel = useMemo(() => {
    const map = new Map<string, SelectTagOption>();
    for (const o of options) map.set(o.label.toLowerCase(), o);
    return map;
  }, [options]);

  const selectedOptions = useMemo<ReadonlyArray<SelectTagOption>>(
    () =>
      values
        .map((id) => optionById.get(id))
        .filter((o): o is SelectTagOption => o !== undefined),
    [values, optionById],
  );

  const { visible: visibleChips, hidden: hiddenChips } = useMemo(
    () => computeVisibility(selectedOptions, maxVisibleChips),
    [selectedOptions, maxVisibleChips],
  );

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const filtered = useMemo(
    () =>
      options.filter((o) => {
        if (lower.length === 0) return true;
        return o.label.toLowerCase().includes(lower);
      }),
    [options, lower],
  );

  const exactMatch = lower.length > 0 && optionByLabel.has(lower);
  const showCreate =
    onCreate !== undefined && trimmed.length > 0 && !exactMatch;

  const selectedIdSet = useMemo(() => new Set(values), [values]);

  // ── Mutations (single source of truth for onChange emissions) ──────

  const addOne = (id: string): void => {
    if (selectedIdSet.has(id)) return;
    onChange([...values, id]);
  };

  const removeOne = (id: string): void => {
    if (!selectedIdSet.has(id)) return;
    onChange(values.filter((v) => v !== id));
  };

  const toggle = (id: string): void => {
    if (selectedIdSet.has(id)) {
      removeOne(id);
      return;
    }
    addOne(id);
  };

  const clearAll = (): void => {
    if (valuesLength === 0) return;
    onChange([]);
  };

  // ── RAC handlers ────────────────────────────────────────────────────

  const handleSelectFromList = (key: React.Key | null): void => {
    if (key === null) return;
    if (key === CREATE_KEY) {
      if (onCreate !== undefined && trimmed.length > 0) {
        onCreate(trimmed);
        setQuery("");
      }
      return;
    }
    if (typeof key !== "string") return;
    toggle(key);
    setQuery("");
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (
      e.key === "Backspace" &&
      query.length === 0 &&
      valuesLength > 0
    ) {
      e.preventDefault();
      const last = values[valuesLength - 1];
      if (last !== undefined) removeOne(last);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    if (!splitOnPaste) return;
    const text = e.clipboardData.getData("text");
    if (!text || !/[,;\n]/.test(text)) return;
    e.preventDefault();

    const fragments = text
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (fragments.length === 0) return;

    const toAdd: string[] = [];
    const toCreate: string[] = [];
    const seenLocal = new Set<string>();

    for (const fragment of fragments) {
      const matched = optionByLabel.get(fragment.toLowerCase());
      if (matched !== undefined) {
        if (selectedIdSet.has(matched.id)) continue;
        if (seenLocal.has(matched.id)) continue;
        toAdd.push(matched.id);
        seenLocal.add(matched.id);
      } else if (onCreate !== undefined) {
        toCreate.push(fragment);
      }
    }

    if (toAdd.length > 0) {
      onChange([...values, ...toAdd]);
    }
    // Fire create-callbacks AFTER the batched onChange so the parent's
    // async create-then-onChange flow sees the resolved-id additions first.
    for (const fragment of toCreate) onCreate?.(fragment);

    setQuery("");
  };

  // ── Render ──────────────────────────────────────────────────────────

  const showPlaceholder = valuesLength === 0 && !hasError;
  const showClearAll = isClearable && valuesLength > 0 && isInteractive;
  const showInputArea = isInteractive;
  const popoverDisabled = !isInteractive;

  const reorderGroupId = `${scope}-chip-rail`;
  const enableReorder = reorderable && isInteractive;

  const handleReorderEnd = (event: {
    canceled: boolean;
  }): void => {
    if (event.canceled) return;
    const visibleIds = visibleChips.map((c) => c.id);
    const bucket = { list: visibleIds };
    // The `move` helper consumes the same `event` shape; cast keeps the
    // local type narrow (we only need `canceled` in our signature).
    const next = move(bucket, event as Parameters<typeof move>[1]);
    const nextVisibleIds = (next.list ?? visibleIds) as string[];
    const unchanged =
      nextVisibleIds.length === visibleIds.length &&
      nextVisibleIds.every((id, idx) => id === visibleIds[idx]);
    if (unchanged) return;
    const hiddenIds = hiddenChips.map((c) => c.id);
    onChange([...nextVisibleIds, ...hiddenIds]);
  };

  const renderChip = (option: SelectTagOption, index: number): ReactElement => (
    <Chip
      key={option.id}
      option={option}
      index={index}
      scope={scope}
      groupId={reorderGroupId}
      reorderable={enableReorder}
      isInteractive={isInteractive}
      onRemove={removeOne}
    />
  );

  const chipRow = visibleChips.length > 0 ? (
    <div
      className={styles.tagGroup}
      role="list"
      aria-label={`${label} — selected`}
    >
      {visibleChips.map((option, index) => renderChip(option, index))}
    </div>
  ) : null;

  return (
    <div
      className={cn(styles.root, className)}
      data-testid={scope}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
      data-invalid={hasError || undefined}
    >
      <AriaComboBox
        className={styles.combobox}
        inputValue={query}
        onInputChange={setQuery}
        selectedKey={null}
        onSelectionChange={handleSelectFromList}
        menuTrigger="focus"
        allowsEmptyCollection
        isDisabled={popoverDisabled}
      >
        <AriaLabel className={styles.label}>{label}</AriaLabel>
        <FieldShell
          scope={scope}
          hasError={hasError}
          disabled={disabled}
          readOnly={readOnly}
          enableReorder={enableReorder}
          onReorderEnd={handleReorderEnd}
        >
          {chipRow}

          {hiddenChips.length > 0 ? (
            <OverflowCounter
              scope={scope}
              hidden={hiddenChips}
            />
          ) : null}

          {showInputArea ? (
            <AriaInput
              className={styles.input}
              placeholder={showPlaceholder ? placeholder : ""}
              onKeyDown={handleInputKeyDown}
              onPaste={handlePaste}
              data-testid={`${scope}-input`}
            />
          ) : null}

          {showClearAll ? (
            <button
              type="button"
              className={styles.clearAll}
              onClick={clearAll}
              aria-label="Clear all"
              data-testid={`${scope}-clear-all`}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </FieldShell>

        <AriaPopover className={styles.popover}>
          {isLoading ? (
            <div
              className={styles.loading}
              role="status"
              data-testid={`${scope}-loading`}
            >
              Loading…
            </div>
          ) : (
            <AriaListBox<SelectTagOption | { id: string; label: string }>
              className={styles.listbox}
              renderEmptyState={() => (
                <div
                  className={styles.empty}
                  data-testid={`${scope}-empty`}
                >
                  {trimmed.length > 0
                    ? `No matches for "${trimmed}"`
                    : "Start typing to search…"}
                </div>
              )}
            >
              {filtered.map((option) => {
                const isSelected = selectedIdSet.has(option.id);
                return (
                  <AriaListBoxItem
                    key={option.id}
                    id={option.id}
                    textValue={option.label}
                    className={cn(
                      styles.option,
                      isSelected && styles.optionSelected,
                    )}
                    data-testid={`${scope}-option-${option.id}`}
                  >
                    <span
                      className={styles.optionCheck}
                      aria-hidden="true"
                      data-selected={isSelected || undefined}
                    >
                      {isSelected ? "✓" : ""}
                    </span>
                    {option.color ? (
                      <span
                        className={styles.optionSwatch}
                        style={{ backgroundColor: option.color }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className={styles.optionLabel}>{option.label}</span>
                    {option.description ? (
                      <span className={styles.optionDescription}>
                        {option.description}
                      </span>
                    ) : null}
                  </AriaListBoxItem>
                );
              })}
              {showCreate ? (
                <AriaListBoxItem
                  key={CREATE_KEY}
                  id={CREATE_KEY}
                  textValue={`Create ${trimmed}`}
                  className={cn(styles.option, styles.optionCreate)}
                  data-testid={`${scope}-create`}
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
          )}
        </AriaPopover>
      </AriaComboBox>

      {hasError ? (
        <p
          className={styles.errorText}
          role="alert"
          data-testid={`${scope}-error`}
        >
          {errorMessage}
        </p>
      ) : description ? (
        <p
          className={styles.description}
          data-testid={`${scope}-description`}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

// ── Field shell (with optional DnD context) ──────────────────────────

interface FieldShellProps {
  scope: string;
  hasError: boolean;
  disabled: boolean;
  readOnly: boolean;
  enableReorder: boolean;
  onReorderEnd: (event: { canceled: boolean }) => void;
  children: ReactNode;
}

function FieldShell({
  scope,
  hasError,
  disabled,
  readOnly,
  enableReorder,
  onReorderEnd,
  children,
}: FieldShellProps): ReactElement {
  const shell = (
    <div
      className={cn(
        styles.fieldWrap,
        hasError && styles.fieldWrapInvalid,
        disabled && styles.fieldWrapDisabled,
        readOnly && styles.fieldWrapReadonly,
      )}
      data-testid={`${scope}-field`}
    >
      {children}
    </div>
  );
  if (!enableReorder) return shell;
  return <DragDropProvider onDragEnd={onReorderEnd}>{shell}</DragDropProvider>;
}

// ── Chip (with optional drag handle) ─────────────────────────────────

interface ChipProps {
  option: SelectTagOption;
  index: number;
  scope: string;
  groupId: string;
  reorderable: boolean;
  isInteractive: boolean;
  onRemove: (id: string) => void;
}

function Chip({
  option,
  index,
  scope,
  groupId,
  reorderable,
  isInteractive,
  onRemove,
}: ChipProps): ReactElement {
  const { ref, handleRef, isDragging } = useSortable({
    id: option.id,
    index,
    group: groupId,
    type: "select-tag-chip",
    accept: ["select-tag-chip"],
    disabled: !reorderable,
  });

  return (
    <span
      ref={(el) => ref(el)}
      className={cn(styles.tag, reorderable && isDragging && styles.tagDragging)}
      data-testid={`${scope}-chip-${option.id}`}
    >
      {reorderable ? (
        <button
          type="button"
          ref={(el) => handleRef(el)}
          className={styles.tagHandle}
          aria-label={`Reorder ${option.label}. Use drag or arrow keys.`}
          data-testid={`${scope}-chip-handle-${option.id}`}
          onMouseDown={(e) => {
            // Don't steal focus from the combobox input.
            e.preventDefault();
          }}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
      ) : null}
      {option.color ? (
        <span
          className={styles.tagSwatch}
          style={{ backgroundColor: option.color }}
          aria-hidden="true"
        />
      ) : null}
      <span className={styles.tagLabel}>{option.label}</span>
      {isInteractive ? (
        <button
          type="button"
          className={styles.tagRemove}
          aria-label={`Remove ${option.label}`}
          data-testid={`${scope}-chip-remove-${option.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(option.id);
          }}
          onMouseDown={(e) => {
            // Don't steal focus from the combobox input.
            e.preventDefault();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </span>
  );
}

// ── Overflow `+N` counter ─────────────────────────────────────────────

interface OverflowCounterProps {
  scope: string;
  hidden: ReadonlyArray<SelectTagOption>;
}

/**
 * The overflow popover uses a plain controlled-state pattern (not RAC
 * `DialogTrigger`) because the counter button lives inside the RAC
 * `<ComboBox>` subtree — nesting another overlay-trigger there triggers
 * RAC's "PressResponder rendered without a pressable child" warning and
 * captures press events that should reach the combobox input. A native
 * `<button>` + a conditional `<div>` listing the hidden labels keeps the
 * popover self-contained and accessibility-correct.
 */
function OverflowCounter({
  scope,
  hidden,
}: OverflowCounterProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  // Close on outside click (RAC's Popover does this for us when wired to
  // DialogTrigger — here we mirror it with a global pointerdown listener
  // bound only while the popover is open).
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Element | null;
      if (target?.closest(`[data-overflow-scope="${scope}"]`) !== null) return;
      setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isOpen, scope]);

  return (
    <span className={styles.overflowWrap} data-overflow-scope={scope}>
      <button
        type="button"
        className={styles.overflowCounter}
        aria-label={`Show ${hidden.length} more selected`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        data-testid={`${scope}-overflow`}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((v) => !v);
        }}
        onMouseDown={(e) => {
          // Don't steal focus from the combobox input.
          e.preventDefault();
        }}
      >
        +{hidden.length}
      </button>
      {isOpen ? (
        <div
          className={styles.overflowDialog}
          role="dialog"
          aria-label="Hidden selections"
        >
          <ul
            className={styles.overflowList}
            data-testid={`${scope}-overflow-list`}
          >
            {hidden.map((option) => (
              <li
                key={option.id}
                className={styles.overflowItem}
                data-testid={`${scope}-overflow-item-${option.id}`}
              >
                {option.color ? (
                  <span
                    className={styles.tagSwatch}
                    style={{ backgroundColor: option.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <span>{option.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
