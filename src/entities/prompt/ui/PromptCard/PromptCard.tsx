import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { Prompt } from "../../model/types";

import styles from "./PromptCard.module.css";

export interface PromptCardProps {
  /**
   * Prompt to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  prompt?: Prompt;
  /** Click / keyboard-activate handler. Receives the prompt id. */
  onSelect?: (id: string) => void;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `usePrompts()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `PromptCard` — presentational card for a single Prompt.
 *
 * Layout (vertical):
 *   - top:    `name` (single line, truncated with ellipsis)
 *   - middle: `shortDescription` if present (muted text)
 *   - bottom: meta row — optional color swatch + optional token-count chip
 *
 * Uses a native `<button>` for activation so Enter, Space, and platform
 * a11y semantics come for free.
 *
 * Token-pair: `--color-text-default` on `--color-surface-raised`.
 * Reduced-motion: hover transitions are guarded via `@media (prefers-reduced-motion: reduce)`.
 */
export function PromptCard({
  prompt,
  onSelect,
  isPending = false,
  className,
}: PromptCardProps): ReactElement {
  if (isPending || !prompt) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="prompt-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonName)} />
        <div className={cn(styles.skeletonLine, styles.skeletonDesc)} />
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(prompt.id)}
    >
      <span className={styles.name} title={prompt.name}>
        {prompt.name}
      </span>

      {prompt.shortDescription !== null && (
        <span className={styles.description}>{prompt.shortDescription}</span>
      )}

      <span className={styles.meta}>
        {prompt.color !== null && (
          <span
            className={styles.colorSwatch}
            style={{ backgroundColor: prompt.color }}
            aria-label={`Color: ${prompt.color}`}
          />
        )}
        {prompt.tokenCount !== null && prompt.tokenCount > 0n && (
          <span className={styles.tokenChip} aria-label="Количество токенов">
            ≈{prompt.tokenCount.toString()} tokens
          </span>
        )}
      </span>
    </button>
  );
}
