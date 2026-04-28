import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { Board } from "../../model/types";

import styles from "./BoardCard.module.css";

export interface BoardCardProps {
  /**
   * Board to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  board?: Board;
  /** Click / keyboard-activate handler. Receives the board id. */
  onSelect?: (id: string) => void;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `useBoards()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `BoardCard` — presentational card for a single Board.
 *
 * Why a `<button>` and not a `<div role="button">`? Native buttons get
 * focus, Enter, Space, and platform a11y semantics for free. Spreading
 * an `onClick` over a div would force us to hand-roll keyboard
 * handlers (and the result would be inferior to the platform default).
 *
 * Token-pair: `--color-text-default` on `--color-surface-raised`.
 *   Light: warm-900 on white = 16.5:1 → AAA.
 *   Dark:  warm-100 on warm-800 = 12.6:1 → AAA.
 *
 * Reduced-motion: hover transitions are guarded in the module's
 * `@media (prefers-reduced-motion: reduce)` block.
 */
export function BoardCard({
  board,
  onSelect,
  isPending = false,
  className,
}: BoardCardProps): ReactElement {
  if (isPending || !board) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="board-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonName)} />
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(board.id)}
    >
      <span className={styles.name}>{board.name}</span>
      <span className={styles.meta}>
        <span className={styles.spaceBadge} title="Space id">
          {board.spaceId}
        </span>
        <span className={styles.position} aria-label="Position rank">
          #{board.position}
        </span>
      </span>
    </button>
  );
}
