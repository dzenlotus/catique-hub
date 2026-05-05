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
   * When provided, an inline `×` button renders inside the pill on the
   * right side. Click fires this handler with the tag id. Designed for
   * "remove tag from prompt" affordances so the close lives inside the
   * chip rather than as a sibling.
   */
  onRemove?: (id: string) => void;
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
  onRemove,
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

  const swatch =
    tag.color !== null ? (
      <span
        className={styles.swatch}
        style={{ backgroundColor: tag.color }}
        aria-hidden="true"
      />
    ) : null;

  const name = <span className={styles.name}>{tag.name}</span>;

  // Close button — rendered as a sibling of the chip body inside the
  // pill so the chip itself stays clickable (when `onSelect` is set)
  // without the × hijacking the row activation.
  const removeBtn = onRemove ? (
    <button
      type="button"
      className={styles.removeBtn}
      onClick={(e) => {
        e.stopPropagation();
        onRemove(tag.id);
      }}
      aria-label={`Remove tag ${tag.name}`}
      data-testid={`tag-chip-remove-${tag.id}`}
    >
      <span aria-hidden="true">×</span>
    </button>
  ) : null;

  if (onSelect) {
    // Interactive variant. The pill's outer wrapper is a `<span>`
    // (not a `<button>`) so we can nest the close `<button>` inside —
    // nested buttons are invalid HTML. Activation lives on a separate
    // inner button that wraps swatch + name.
    return (
      <span className={cn(styles.chip, styles.interactive, className)}>
        <button
          type="button"
          className={styles.bodyBtn}
          onClick={() => onSelect(tag.id)}
        >
          {swatch}
          {name}
        </button>
        {removeBtn}
      </span>
    );
  }

  return (
    <span className={cn(styles.chip, className)}>
      {swatch}
      {name}
      {removeBtn}
    </span>
  );
}
