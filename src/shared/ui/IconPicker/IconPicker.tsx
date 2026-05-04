/**
 * IconPicker — popover-based picker over the bundled Pixel icon set.
 *
 * Value contract: a string identifier matching one of the keys exported
 * by `@shared/ui/Icon` (e.g. "PixelInterfaceEssentialMessage"). Empty
 * string / null = no icon. Consumers persist this string in their
 * domain model and use `<IconRenderer name={value} />` (below) to draw
 * the chosen icon.
 *
 * The popover is implemented with react-aria-components so focus
 * management, scrim dismiss, and Esc behaviour come for free. The grid
 * is virtualised by the simple "cap to first N matches" heuristic —
 * 663 icons render fast enough that a windowing library is overkill,
 * but capping at 200 keeps the initial paint under 50 ms even on
 * lower-end laptops.
 */

import {
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Popover, DialogTrigger } from "react-aria-components";

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
  "aria-hidden": ariaHidden = true,
}: {
  name: string | null | undefined;
  width?: number;
  height?: number;
  className?: string;
  "aria-hidden"?: boolean;
}): ReactElement | null {
  if (name === null || name === undefined || name === "") return null;
  const Component = (IconSet as Record<string, unknown>)[name];
  if (typeof Component !== "function") return null;
  // The icon components accept SVG props; cast through unknown for safety.
  const IconComp = Component as (props: {
    width?: number;
    height?: number;
    className?: string;
    "aria-hidden"?: boolean;
  }) => ReactElement;
  return (
    <IconComp
      width={width}
      height={height}
      {...(className !== undefined ? { className } : {})}
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
      <button
        type="button"
        className={cn(styles.trigger, value === null && styles.triggerEmpty)}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        {value !== null ? (
          <IconRenderer name={value} width={20} height={20} />
        ) : (
          <span aria-hidden="true">+</span>
        )}
      </button>
      <Popover className={styles.popover} placement="bottom start">
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
                  testId !== undefined ? `${testId}-option-${name}` : undefined
                }
              >
                <IconRenderer name={name} width={20} height={20} />
              </button>
            ))}
          </div>
        )}
      </Popover>
    </DialogTrigger>
  );
}
