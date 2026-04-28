import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import { usePromptGroupMembers } from "../../model/store";
import type { PromptGroup } from "../../model/types";

import styles from "./PromptGroupCard.module.css";

export interface PromptGroupCardProps {
  /**
   * PromptGroup to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  group?: PromptGroup;
  /** Click / keyboard-activate handler. Receives the group id. */
  onSelect?: (id: string) => void;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `usePromptGroups()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `PromptGroupCard` — presentational card for a single PromptGroup.
 *
 * Vertical layout:
 *   - top: name (single line, truncated, semibold)
 *   - middle: members-count badge ("3 prompts") derived from `usePromptGroupMembers`
 *   - bottom meta row: optional color swatch + position chip
 *
 * Native `<button>` for activation — gets focus, Enter, Space, and
 * platform a11y semantics for free.
 */
export function PromptGroupCard({
  group,
  onSelect,
  isPending = false,
  className,
}: PromptGroupCardProps): ReactElement {
  if (isPending || !group) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="prompt-group-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonName)} />
        <div className={cn(styles.skeletonLine, styles.skeletonCount)} />
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
      </div>
    );
  }

  return (
    <PromptGroupCardLoaded
      group={group}
      {...(onSelect !== undefined ? { onSelect } : {})}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal loaded variant — owns the members query

interface PromptGroupCardLoadedProps {
  group: PromptGroup;
  onSelect?: ((id: string) => void) | undefined;
  className?: string | undefined;
}

function PromptGroupCardLoaded({
  group,
  onSelect,
  className,
}: PromptGroupCardLoadedProps): ReactElement {
  const membersQuery = usePromptGroupMembers(group.id);
  const memberCount = membersQuery.data?.length ?? 0;

  const countLabel =
    membersQuery.status === "pending"
      ? "…"
      : membersQuery.status === "error"
        ? "?"
        : pluralizePrompts(memberCount);

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(group.id)}
    >
      <span className={styles.name} title={group.name}>
        {group.name}
      </span>

      <span className={styles.memberCount}>{countLabel}</span>

      <span className={styles.meta}>
        {group.color !== null ? (
          <span
            className={styles.colorSwatch}
            style={{ backgroundColor: group.color }}
            aria-label={`Color: ${group.color}`}
          />
        ) : null}
        <span className={styles.positionChip}>
          #{group.position.toString()}
        </span>
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function pluralizePrompts(count: number): string {
  if (count === 1) return "1 prompt";
  return `${count} prompts`;
}
