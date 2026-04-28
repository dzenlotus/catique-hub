import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { Tag } from "../../model/types";

import styles from "./TagChip.module.css";

export interface TagChipProps {
  /**
   * Tag to render. When omitted (or with `isPending`), the chip renders
   * a skeleton placeholder.
   */
  tag?: Tag;
  /**
   * When provided the chip renders as a `<button>` and calls this
   * handler with the tag id on activation. Without it the chip is a
   * static, non-interactive pill.
   */
  onSelect?: (id: string) => void;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `TagChip` — compact presentational pill for a single Tag.
 *
 * Two variants:
 *   - Static (default): non-interactive `<span>` pill.
 *   - Interactive: when `onSelect` is provided, renders as a `<button>`
 *     with hover/focus styles and fires `onSelect(tag.id)` on click.
 *
 * Layout (left → right):
 *   [color swatch?] [name] [kind badge? — not present in current binding]
 *
 * Token usage: `var(--radius-xl)` for the pill border-radius;
 * `var(--space-2) var(--space-8)` for padding;
 * `var(--font-size-caption)` for inline text.
 */
export function TagChip({
  tag,
  onSelect,
  isPending = false,
  className,
}: TagChipProps): ReactElement {
  if (isPending || !tag) {
    return (
      <span
        className={cn(styles.chip, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="tag-chip-skeleton"
      />
    );
  }

  const inner = (
    <>
      {tag.color !== null ? (
        <span
          className={styles.swatch}
          style={{ backgroundColor: tag.color }}
          aria-hidden="true"
        />
      ) : null}
      <span className={styles.name}>{tag.name}</span>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className={cn(styles.chip, styles.interactive, className)}
        onClick={() => onSelect(tag.id)}
      >
        {inner}
      </button>
    );
  }

  return (
    <span className={cn(styles.chip, className)}>
      {inner}
    </span>
  );
}
