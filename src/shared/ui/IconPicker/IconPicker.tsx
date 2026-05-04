/**
 * IconPicker — popover-based picker over the bundled Pixel icon set.
 *
 * Value contract: a string identifier matching one of the keys exported
 * by `@shared/ui/Icon` (e.g. "PixelInterfaceEssentialMessage"). Empty
 * string / null = no icon. Consumers persist this string in their
 * domain model and use `<IconRenderer name={value} />` to draw the
 * chosen icon.
 *
 * The popover follows the canonical react-aria-components pattern:
 * `<DialogTrigger>` with RAC's `<Button>` as the trigger and
 * `<Popover>` > `<Dialog>` as the body. RAC's Button gives Pressable
 * semantics (keyboard, focus, hover) so the trigger actually opens
 * the popover; a plain `<button>` element does not.
 */

import {
  useMemo,
  useState,
  type ComponentType,
  type ReactElement,
} from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Popover,
} from "react-aria-components";

import { cn } from "@shared/lib";
import * as IconSet from "@shared/ui/Icon";

import styles from "./IconPicker.module.css";

const MAX_VISIBLE = 200;

/** Available icon names harvested from the auto-generated `@shared/ui/Icon` index. */
const ICON_NAMES: ReadonlyArray<string> = Object.keys(IconSet)
  .filter((key) => key.startsWith("Pixel"))
  .sort();

/**
 * Renders a single Pixel icon by name. Returns `null` when the name
 * doesn't resolve to a known icon (e.g. legacy data or a typo).
 */
export function IconRenderer({
  name,
  width = 16,
  height = 16,
  className,
  style,
  "aria-hidden": ariaHidden = true,
}: {
  name: string | null | undefined;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean;
}): ReactElement | null {
  if (name === null || name === undefined || name === "") return null;
  const Component = (IconSet as Record<string, unknown>)[name];
  // `?react` SVG imports may produce either a plain function or a
  // forwardRef / memo object — both are valid React components but
  // only the function form satisfies `typeof === "function"`. Accept
  // both shapes so the grid actually renders icons in production.
  if (
    Component === undefined ||
    Component === null ||
    (typeof Component !== "function" && typeof Component !== "object")
  ) {
    return null;
  }
  type IconProps = {
    width?: number;
    height?: number;
    className?: string;
    style?: React.CSSProperties;
    "aria-hidden"?: boolean;
  };
  const IconComp = Component as ComponentType<IconProps>;
  return (
    <IconComp
      width={width}
      height={height}
      {...(className !== undefined ? { className } : {})}
      {...(style !== undefined ? { style } : {})}
      aria-hidden={ariaHidden}
    />
  );
}

export interface IconPickerProps {
  /** Currently selected icon name (or null for none). */
  value: string | null;
  /** Called with the new icon name (or null when cleared). */
  onChange: (next: string | null) => void;
  /** Optional aria-label for the trigger button. */
  ariaLabel?: string;
  /** Test id forwarded to the trigger button. */
  "data-testid"?: string;
}

export function IconPicker({
  value,
  onChange,
  ariaLabel = "Icon",
  "data-testid": testId,
}: IconPickerProps): ReactElement {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) return ICON_NAMES.slice(0, MAX_VISIBLE);
    const matches: string[] = [];
    for (const name of ICON_NAMES) {
      if (name.toLowerCase().includes(trimmed)) {
        matches.push(name);
        if (matches.length >= MAX_VISIBLE) break;
      }
    }
    return matches;
  }, [query]);

  const handleSelect = (name: string): void => {
    onChange(name);
    setIsOpen(false);
  };

  const handleClear = (): void => {
    onChange(null);
    setIsOpen(false);
  };

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <AriaButton
        className={cn(styles.trigger, value === null && styles.triggerEmpty)}
        aria-label={ariaLabel}
        {...(testId !== undefined ? { "data-testid": testId } : {})}
      >
        {value !== null ? (
          <IconRenderer name={value} width={14} height={14} />
        ) : (
          <span aria-hidden="true">+</span>
        )}
      </AriaButton>
      <Popover className={styles.popover} placement="bottom start">
        <AriaDialog className={styles.dialog} aria-label="Icon picker">
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            data-testid={
              testId !== undefined ? `${testId}-search` : undefined
            }
          />
          <div className={styles.toolbar}>
            <span>
              {filtered.length}
              {filtered.length >= MAX_VISIBLE ? "+" : ""} matches
            </span>
            {value !== null ? (
              <button
                type="button"
                className={styles.clearButton}
                onClick={handleClear}
                data-testid={
                  testId !== undefined ? `${testId}-clear` : undefined
                }
              >
                Clear icon
              </button>
            ) : null}
          </div>
          {filtered.length === 0 ? (
            <div className={styles.empty}>No icons match “{query}”.</div>
          ) : (
            <div
              className={styles.grid}
              data-testid={
                testId !== undefined ? `${testId}-grid` : undefined
              }
            >
              {filtered.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={cn(
                    styles.iconCell,
                    name === value && styles.iconCellActive,
                  )}
                  title={name.replace(/^Pixel/, "")}
                  aria-label={name}
                  onClick={() => handleSelect(name)}
                  data-testid={
                    testId !== undefined
                      ? `${testId}-option-${name}`
                      : undefined
                  }
                >
                  <IconRenderer name={name} width={20} height={20} />
                </button>
              ))}
            </div>
          )}
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}
