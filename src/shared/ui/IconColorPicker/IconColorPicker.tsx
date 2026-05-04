/**
 * IconColorPicker — combined icon + color trigger.
 *
 * Replaces the separate `<IconPicker>` + native color input pair in
 * the prompt editors. The trigger renders the chosen icon tinted
 * with the chosen color, OR a plain colored circle when no icon is
 * set, OR a "+" placeholder when neither is set. Clicking opens a
 * popover with both controls — the user can pick / change either
 * facet without leaving the popover.
 */

import { useMemo, useState, type ReactElement } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Popover,
} from "react-aria-components";

import { cn } from "@shared/lib";
import * as IconSet from "@shared/ui/Icon";
import { IconRenderer } from "@shared/ui/IconPicker";

import styles from "./IconColorPicker.module.css";

const MAX_VISIBLE = 200;

const ICON_NAMES: ReadonlyArray<string> = Object.keys(IconSet)
  .filter((key) => key.startsWith("Pixel"))
  .sort();

export interface IconColorValue {
  /** Pixel-icon identifier (matches `@shared/ui/Icon` keys). */
  icon: string | null;
  /** CSS hex color. */
  color: string | null;
}

export interface IconColorPickerProps {
  value: IconColorValue;
  onChange: (next: IconColorValue) => void;
  ariaLabel?: string;
  "data-testid"?: string;
}

export function IconColorPicker({
  value,
  onChange,
  ariaLabel = "Icon and color",
  "data-testid": testId,
}: IconColorPickerProps): ReactElement {
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

  const setIcon = (next: string | null): void => {
    onChange({ ...value, icon: next });
  };
  const setColor = (next: string | null): void => {
    onChange({ ...value, color: next });
  };

  // Render priority for the trigger:
  //   1. Icon set    → colored icon glyph.
  //   2. No icon, color set → colored circle.
  //   3. Neither     → "+" placeholder.
  const triggerContent = (() => {
    if (value.icon !== null) {
      return (
        <IconRenderer
          name={value.icon}
          width={18}
          height={18}
          className={styles.icon}
          {...(value.color !== null
            ? { style: { color: value.color } }
            : {})}
        />
      );
    }
    return (
      <span
        className={styles.dot}
        style={
          value.color !== null
            ? ({ ["--dot-color" as string]: value.color } as React.CSSProperties)
            : undefined
        }
        aria-hidden="true"
      />
    );
  })();

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <AriaButton
        className={styles.trigger}
        aria-label={ariaLabel}
        {...(testId !== undefined ? { "data-testid": testId } : {})}
      >
        {triggerContent}
      </AriaButton>
      <Popover className={styles.popover} placement="bottom start">
        <AriaDialog className={styles.dialog} aria-label="Icon and color picker">
          {/* Color row */}
          <div className={styles.colorRow}>
            <span className={styles.colorLabel}>Color</span>
            <input
              type="color"
              className={styles.colorInput}
              value={value.color ?? "#000000"}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Color"
              data-testid={
                testId !== undefined ? `${testId}-color` : undefined
              }
            />
            {value.color !== null ? (
              <button
                type="button"
                className={styles.colorClear}
                onClick={() => setColor(null)}
                data-testid={
                  testId !== undefined ? `${testId}-color-clear` : undefined
                }
              >
                Reset
              </button>
            ) : null}
          </div>

          {/* Icon search + grid */}
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid={
              testId !== undefined ? `${testId}-search` : undefined
            }
          />
          <div className={styles.toolbar}>
            <span>
              {filtered.length}
              {filtered.length >= MAX_VISIBLE ? "+" : ""} matches
            </span>
            {value.icon !== null ? (
              <button
                type="button"
                className={styles.iconClear}
                onClick={() => setIcon(null)}
                data-testid={
                  testId !== undefined ? `${testId}-icon-clear` : undefined
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
                    name === value.icon && styles.iconCellActive,
                  )}
                  title={name.replace(/^Pixel/, "")}
                  aria-label={name}
                  onClick={() => setIcon(name)}
                  data-testid={
                    testId !== undefined
                      ? `${testId}-option-${name}`
                      : undefined
                  }
                >
                  <IconRenderer
                    name={name}
                    width={20}
                    height={20}
                    {...(value.color !== null && name === value.icon
                      ? { style: { color: value.color } }
                      : {})}
                  />
                </button>
              ))}
            </div>
          )}
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}
