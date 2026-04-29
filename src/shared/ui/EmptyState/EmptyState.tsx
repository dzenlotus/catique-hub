/**
 * EmptyState — DS v1 empty-state block.
 *
 * Renders a centred column (max-width ~400 px) with:
 *   - optional icon node at 64 px, 50 % opacity
 *   - Playfair Display heading (18–20 px, navy)
 *   - muted sans-serif description (14 px)
 *   - optional action node (primary CTA button, etc.)
 *
 * Designed to drop into any list widget's `data.length === 0` branch.
 */

import type { ReactNode } from "react";

import { cn } from "@shared/lib";

import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  /** Optional icon node shown at 50 % opacity. Pass e.g. <PixelFoo width={64} height={64} />. */
  icon?: ReactNode;
  /** Short heading — Playfair Display, ~18 px, navy. */
  title: string;
  /** One-to-two sentence description — muted, 14 px. */
  description: string;
  /** Optional CTA slot (e.g. a primary Button). Rendered below description. */
  action?: ReactNode;
  /** Extra class merged onto the root element. */
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      className={cn(styles.root, className)}
      data-testid="empty-state"
    >
      {icon !== undefined && (
        <span className={styles.iconWrap} aria-hidden="true">
          {icon}
        </span>
      )}

      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{description}</p>

      {action !== undefined && (
        <div className={styles.action}>{action}</div>
      )}
    </div>
  );
}
