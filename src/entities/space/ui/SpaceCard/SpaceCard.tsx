import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { Space } from "../../model/types";

import styles from "./SpaceCard.module.css";

export interface SpaceCardProps {
  /**
   * Space to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  space?: Space;
  /** Click / keyboard-activate handler. Receives the space id. */
  onSelect?: (id: string) => void;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `useSpaces()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `SpaceCard` — presentational card for a single Space.
 *
 * Vertical layout:
 *   - top: name (single line, truncated, semibold)
 *   - middle (optional): description preview (1-line, muted, truncated)
 *   - bottom meta row: prefix badge, default-marker, position chip
 *
 * Native `<button>` for activation — gets focus, Enter, Space, and
 * platform a11y semantics for free.
 *
 * Reduced-motion: hover transitions are guarded in the module's
 * `@media (prefers-reduced-motion: reduce)` block.
 */
export function SpaceCard({
  space,
  onSelect,
  isPending = false,
  className,
}: SpaceCardProps): ReactElement {
  if (isPending || !space) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="space-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonName)} />
        <div className={cn(styles.skeletonLine, styles.skeletonDescription)} />
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
      </div>
    );
  }

  const hasDescription =
    space.description !== null && space.description.trim().length > 0;

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(space.id)}
    >
      <span className={styles.name} title={space.name}>
        {space.name}
      </span>

      {hasDescription ? (
        <span className={styles.description} title={space.description ?? undefined}>
          {space.description}
        </span>
      ) : null}

      <span className={styles.meta}>
        <span className={styles.prefixBadge} aria-label={`Prefix: ${space.prefix}`}>
          {space.prefix}
        </span>

        {space.isDefault ? (
          <span className={styles.defaultMarker} aria-label="Default space">
            default
          </span>
        ) : null}

        <span className={styles.position} aria-label="Position rank">
          #{space.position}
        </span>
      </span>
    </button>
  );
}
