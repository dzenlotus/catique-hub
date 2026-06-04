/**
 * `PaletteRow` — single parameterised row for the Cmd+K palette.
 *
 * Replaces the three near-identical `ActionRow` / `ResultRow` /
 * `PromptResultRow` components: every palette row is a focusable
 * `role="option"` button with a title + optional snippet, a focus-driven
 * `scrollIntoView`, and arbitrary extra `data-*` attributes (used by the
 * prompt rows to carry `data-result-kind` / `data-prompt-id`).
 */
import {
  useEffect,
  useRef,
  type ReactElement,
} from "react";

import styles from "./GlobalSearch.module.css";

export interface PaletteRowProps {
  /** Primary line. */
  title: string;
  /** Optional muted second line (snippet / hint / excerpt). */
  snippet?: string;
  /** Whether this row is the keyboard-focused row. */
  isFocused: boolean;
  /** Activate the row (click / Enter delegated by the list). */
  onSelect: () => void;
  /** Sync keyboard focus to this row on hover. */
  onHover: () => void;
  /** Stable test id for the row root. */
  testId: string;
  /** Extra data-* attributes (e.g. result kind / prompt id). */
  dataAttrs?: Record<string, string>;
}

export function PaletteRow({
  title,
  snippet,
  isFocused,
  onSelect,
  onHover,
  testId,
  dataAttrs,
}: PaletteRowProps): ReactElement {
  const rowRef = useRef<HTMLButtonElement>(null);

  // Scroll the focused row into view when focus moves via keyboard.
  // scrollIntoView may be absent in jsdom — guard defensively.
  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView?.({ block: "nearest" });
    }
  }, [isFocused]);

  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={isFocused}
      className={styles.resultItem}
      data-testid={testId}
      data-focused={isFocused ? "true" : "false"}
      onClick={onSelect}
      onMouseEnter={onHover}
      {...dataAttrs}
    >
      <span className={styles.resultTitle}>{title}</span>
      {snippet !== undefined ? (
        <span className={styles.resultSnippet}>{snippet}</span>
      ) : null}
    </button>
  );
}
