/**
 * Chip — shared inline-pill primitive parts.
 *
 * Deduplicates the chip inner visuals (colour swatch + ellipsised label
 * + optional × remove button) previously copy-pasted across:
 *   - `entities/tag/ui/TagChip`
 *   - `shared/ui/SelectTag` (its private `Chip`)
 *
 * Design: composable *parts*, not a single monolith. Each consumer owns
 * its own wrapper element — a plain `<span>` pill, a RAC `<Tag>`, or a
 * drag-sortable `<span>` — and composes the parts inside it. That keeps
 * every consumer's public API, `data-testid`s and react-aria integration
 * intact while sharing one source of truth for the swatch / label /
 * remove-button markup + tokens.
 *
 * `ChipRoot` is the convenience pill wrapper for the simplest case
 * (TagChip's static + interactive variants). Consumers that need a
 * non-`<span>` wrapper (RAC `<Tag>`, sortable refs) skip `ChipRoot` and
 * use the parts directly with their own className from `chipStyles`.
 */

import type { CSSProperties, ReactElement, ReactNode } from "react";

import { cn } from "@shared/lib";

import styles from "./Chip.module.css";

/** Raw style map — for consumers that compose parts into a custom wrapper. */
export { styles as chipStyles };

// ── Swatch ────────────────────────────────────────────────────────────

export interface ChipSwatchProps {
  /** CSS colour string (hex/rgb). When null/undefined, nothing renders. */
  color?: string | null | undefined;
  /** Class merged onto the swatch (lets consumers keep their own sizing). */
  className?: string;
}

/**
 * Small round colour swatch. Renders nothing when `color` is empty so
 * callers can write `<ChipSwatch color={option.color} />` unconditionally.
 */
export function ChipSwatch({ color, className }: ChipSwatchProps): ReactElement | null {
  if (!color) return null;
  return (
    <span
      className={cn(styles.swatch, className)}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

// ── Label ─────────────────────────────────────────────────────────────

export interface ChipLabelProps {
  children: ReactNode;
  className?: string;
}

/** Ellipsised chip label. */
export function ChipLabel({ children, className }: ChipLabelProps): ReactElement {
  return <span className={cn(styles.label, className)}>{children}</span>;
}

// ── Remove button ─────────────────────────────────────────────────────

export interface ChipRemoveProps {
  /** Accessible label, e.g. `Remove React`. Required for a11y. */
  "aria-label": string;
  onClick: () => void;
  className?: string;
  "data-testid"?: string;
  /**
   * When true, `onMouseDown` is prevented so clicking the × inside a
   * combobox-driven field doesn't steal focus from the search input.
   */
  preventFocusSteal?: boolean;
}

/** Inline `×` remove button. */
export function ChipRemove({
  "aria-label": ariaLabel,
  onClick,
  className,
  "data-testid": testId,
  preventFocusSteal = false,
}: ChipRemoveProps): ReactElement {
  return (
    <button
      type="button"
      className={cn(styles.remove, className)}
      aria-label={ariaLabel}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={
        preventFocusSteal
          ? (e) => {
              e.preventDefault();
            }
          : undefined
      }
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}

// ── Root pill (convenience wrapper) ───────────────────────────────────

export interface ChipRootProps {
  children: ReactNode;
  /** Adds the tighter right-padding variant for a trailing × button. */
  hasRemove?: boolean;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/**
 * Default `<span>` pill wrapper. Consumers needing a different element
 * (RAC `<Tag>`, sortable `<span>`) skip this and apply `chipStyles.root`
 * to their own element.
 */
export function ChipRoot({
  children,
  hasRemove = false,
  className,
  style,
  "data-testid": testId,
}: ChipRootProps): ReactElement {
  return (
    <span
      className={cn(styles.root, hasRemove && styles.rootRemovable, className)}
      style={style}
      data-testid={testId}
    >
      {children}
    </span>
  );
}
