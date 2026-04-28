import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { Role } from "../../model/types";

import styles from "./RoleCard.module.css";

export interface RoleCardProps {
  /**
   * Role to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  role?: Role;
  /** Click / keyboard-activate handler. Receives the role id. */
  onSelect?: (id: string) => void;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `useRoles()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `RoleCard` — presentational card for a single Role.
 *
 * Vertical layout:
 *   - top: name (single line, truncated)
 *   - middle (optional): 1-line content preview, muted, truncated
 *   - bottom meta row: optional color swatch + "role" badge
 *
 * Native `<button>` for activation — gets focus, Enter, Space, and
 * platform a11y semantics for free.
 *
 * Reduced-motion: hover transitions are guarded in the module's
 * `@media (prefers-reduced-motion: reduce)` block.
 */
export function RoleCard({
  role,
  onSelect,
  isPending = false,
  className,
}: RoleCardProps): ReactElement {
  if (isPending || !role) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="role-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonName)} />
        <div className={cn(styles.skeletonLine, styles.skeletonContent)} />
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
      </div>
    );
  }

  const hasContent = role.content.trim().length > 0;
  const contentPreview =
    hasContent && role.content.length > 80
      ? `${role.content.slice(0, 80)}…`
      : role.content;

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(role.id)}
    >
      <span className={styles.name} title={role.name}>
        {role.name}
      </span>

      {hasContent ? (
        <span className={styles.contentPreview}>{contentPreview}</span>
      ) : null}

      <span className={styles.meta}>
        {role.color !== null ? (
          <span
            className={styles.colorSwatch}
            style={{ backgroundColor: role.color }}
            aria-label={`Color: ${role.color}`}
          />
        ) : null}
        <span className={styles.roleBadge}>role</span>
      </span>
    </button>
  );
}
