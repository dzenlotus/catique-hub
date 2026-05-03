import {
  forwardRef,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Button as AriaButton,
  Label as AriaLabel,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  ListBoxSection as AriaListBoxSection,
  Header as AriaHeader,
  Popover,
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
  type Key,
  type ListBoxItemProps as AriaListBoxItemProps,
  type SelectProps as AriaSelectProps,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Select.module.css";

/**
 * Plain-data shape consumed by `<Select>` when callers pass `items`
 * instead of nesting `<SelectItem>` children. Mirrors the convention
 * established by `Combobox` (`ComboboxItem`).
 */
export interface SelectOption {
  /** Unique identifier used as the option's `id` and selection key. */
  id: Key;
  /** Visible label rendered inside the option. */
  label: string;
  /** Optional muted secondary text shown to the right of the label. */
  detail?: string;
  /** Disable an individual option without removing it from the list. */
  isDisabled?: boolean;
}

export interface SelectProps<T extends object = SelectOption>
  extends Omit<
    AriaSelectProps<T>,
    "className" | "children" | "items" | "placeholder"
  > {
  /** Visible label (a11y contract: WCAG 3.3.2). */
  label: string;
  /**
   * Placeholder shown when nothing is selected. Defaults to RAC's
   * localized "Select an item" — pass an explicit string for product copy.
   */
  placeholder?: string;
  /**
   * Pre-loaded options. Mutually exclusive with `children` — pass one or
   * the other. Accepts an iterable so callers can pipe `.map()` results.
   */
  items?: Iterable<T>;
  /**
   * Render-prop or static children. Use when option rendering is
   * non-trivial (icons, nested sections). When provided, `items` is
   * ignored unless the children is a render-function `(item) => …`.
   */
  children?: ReactNode | ((item: T) => ReactNode);
  /** Optional helper / no-results node rendered when `items` is empty. */
  emptyState?: ReactNode;
  /**
   * Non-empty `aria-label` for the inner `ListBox` (RAC requires it for
   * the listbox role). Defaults to the visible `label`.
   */
  listboxAriaLabel?: string;
  /** Optional class merged onto the wrapper `<Select>` element. */
  className?: string;
  /** Optional class merged onto the trigger `<Button>` element. */
  triggerClassName?: string;
  /**
   * Test identifier forwarded to the trigger button. The wrapper Select
   * does not receive it because RAC's `Select` is a `<div>` and parents
   * typically want to query the *interactive* trigger.
   */
  "data-testid"?: string;
  /**
   * Where the popover should anchor relative to the trigger.
   * @default "bottom start"
   */
  placement?: "bottom start" | "bottom end" | "top start" | "top end";
  /**
   * Whether the popover should match the trigger's width. RAC provides
   * `--trigger-width` automatically; we default to `true` so the listbox
   * always lines up with the trigger edges.
   * @default true
   */
  matchTriggerWidth?: boolean;
}

/**
 * `Select` — single-select dropdown wrapping
 * `react-aria-components` `Select` + `SelectValue` + `Popover` + `ListBox`.
 *
 * Behaviour delivered by RAC:
 *   - role="listbox" with arrow / Home / End / typeahead navigation.
 *   - Trigger announces selected value via `aria-label` + `aria-expanded`.
 *   - Esc / blur / item activation closes the popover.
 *   - Focus restored to trigger on close.
 *   - Native form submission via the hidden `<select>` element RAC injects.
 *
 * Visual contract: trigger height (32 px), border, radius, focus ring
 * mirror `<Input>` from `shared/ui/Input` — call-sites can mix `<Input>`
 * and `<Select>` flush in a row layout.
 *
 * Usage with `items`:
 *   <Select label="Board" items={boardOptions} selectedKey={boardId}
 *           onSelectionChange={(k) => setBoardId(String(k))}>
 *     {(item) => <SelectItem>{item.label}</SelectItem>}
 *   </Select>
 *
 * Usage with static children:
 *   <Select label="Role" selectedKey={roleId} onSelectionChange={…}>
 *     <SelectItem id="">(no role)</SelectItem>
 *     {roles.map((r) => <SelectItem id={r.id}>{r.name}</SelectItem>)}
 *   </Select>
 */
function SelectImpl<T extends object = SelectOption>(
  {
    label,
    placeholder,
    items,
    children,
    emptyState,
    listboxAriaLabel,
    className,
    triggerClassName,
    "data-testid": dataTestId,
    placement = "bottom start",
    matchTriggerWidth = true,
    ...rest
  }: SelectProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const renderItem =
    typeof children === "function" ? (children as (item: T) => ReactNode) : null;
  const staticChildren = renderItem ? null : (children as ReactNode);

  // RAC's `<ListBox items>` API requires the `children` to be a render
  // function; fall back to a sensible default that treats `T` as
  // `SelectOption`-compatible when the caller passes `items` without
  // supplying a render function.
  const listChildren =
    renderItem ??
    ((item: T) => {
      const opt = item as unknown as SelectOption;
      return (
        <AriaListBoxItem
          id={opt.id}
          textValue={opt.label}
          isDisabled={opt.isDisabled ?? false}
          className={styles.item}
        >
          <span className={styles.itemLabel}>{opt.label}</span>
          {opt.detail ? (
            <span className={styles.itemDetail}>{opt.detail}</span>
          ) : null}
        </AriaListBoxItem>
      );
    });

  return (
    <AriaSelect<T>
      {...rest}
      ref={ref}
      placeholder={placeholder ?? ""}
      className={cn(styles.select, className)}
    >
      <AriaLabel className={styles.label}>{label}</AriaLabel>
      <AriaButton
        className={cn(styles.trigger, triggerClassName)}
        {...(dataTestId ? { "data-testid": dataTestId } : {})}
      >
        <AriaSelectValue className={styles.value} />
        <span aria-hidden="true" className={styles.chevron}>
          <ChevronDownIcon />
        </span>
      </AriaButton>
      <Popover
        className={styles.popover}
        placement={placement}
        offset={4}
        {...(matchTriggerWidth ? {} : {})}
      >
        {items ? (
          <AriaListBox<T>
            items={items}
            aria-label={listboxAriaLabel ?? label}
            className={styles.listbox}
            data-match-trigger-width={matchTriggerWidth ? "true" : undefined}
          >
            {listChildren}
          </AriaListBox>
        ) : (
          <AriaListBox
            aria-label={listboxAriaLabel ?? label}
            className={styles.listbox}
            data-match-trigger-width={matchTriggerWidth ? "true" : undefined}
          >
            {staticChildren}
          </AriaListBox>
        )}
        {emptyState ? <div className={styles.empty}>{emptyState}</div> : null}
      </Popover>
    </AriaSelect>
  );
}

/**
 * `Select` is forwardRef'd so callers can wire the wrapper `<div>`
 * (`Select` is a `<div>` in RAC) for measurement / portal anchors.
 */
export const Select = forwardRef(SelectImpl) as <
  T extends object = SelectOption,
>(
  props: SelectProps<T> & { ref?: ForwardedRef<HTMLDivElement> },
) => ReactElement;

// ─────────────────────────────────────────────────────────────────────────────

export interface SelectItemProps
  extends Omit<AriaListBoxItemProps, "className" | "children"> {
  className?: string;
  children?: ReactNode;
}

/**
 * `SelectItem` — single option (`role="option"`).
 *
 * Pass an `id` (= unique key) so RAC can track selection across re-renders.
 * `textValue` is required when `children` is not a string (typeahead +
 * accessibility name); RAC will fall back to `String(children)` when
 * children is a plain string.
 */
export function SelectItem({
  className,
  children,
  ...rest
}: SelectItemProps): ReactElement {
  return (
    <AriaListBoxItem {...rest} className={cn(styles.item, className)}>
      {children}
    </AriaListBoxItem>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export interface SelectSectionProps {
  title?: string;
  className?: string;
  children: ReactNode;
}

/**
 * `SelectSection` — visual + a11y group (`role="group"`).
 *
 * Sections are optional; use them when the option list has a clear
 * categorical split (e.g. "Recent" vs "All").
 */
export function SelectSection({
  title,
  className,
  children,
}: SelectSectionProps): ReactElement {
  return (
    <AriaListBoxSection className={cn(styles.section, className)}>
      {title ? (
        <AriaHeader className={styles.sectionHeader}>{title}</AriaHeader>
      ) : null}
      {children}
    </AriaListBoxSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inline chevron — kept local so consumers don't need to import
 * `@shared/ui/Icon`. Sized by line-height of the trigger button.
 */
function ChevronDownIcon(): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
