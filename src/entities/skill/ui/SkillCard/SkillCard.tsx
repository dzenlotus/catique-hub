import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { Skill } from "../../model/types";

import styles from "./SkillCard.module.css";

export interface SkillCardProps {
  /**
   * Skill to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  skill?: Skill;
  /** Click / keyboard-activate handler. Receives the skill id. */
  onSelect?: (id: string) => void;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `useSkills()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `SkillCard` — presentational card for a single Skill.
 *
 * Vertical layout:
 *   - top: name (single line, truncated, semibold)
 *   - middle (optional): 1-line description preview, muted, when non-null/non-empty
 *   - bottom meta row: optional color swatch
 *
 * Native `<button>` for activation — gets focus, Enter, Space, and
 * platform a11y semantics for free.
 *
 * Reduced-motion: hover transitions are guarded in the module's
 * `@media (prefers-reduced-motion: reduce)` block.
 */
export function SkillCard({
  skill,
  onSelect,
  isPending = false,
  className,
}: SkillCardProps): ReactElement {
  if (isPending || !skill) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="skill-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonName)} />
        <div className={cn(styles.skeletonLine, styles.skeletonContent)} />
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
      </div>
    );
  }

  const hasDescription =
    skill.description !== null && skill.description.trim().length > 0;

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(skill.id)}
    >
      <span className={styles.name} title={skill.name}>
        {skill.name}
      </span>

      {hasDescription ? (
        <span className={styles.descriptionPreview}>{skill.description}</span>
      ) : null}

      <span className={styles.meta}>
        {skill.color !== null ? (
          <span
            className={styles.colorSwatch}
            style={{ backgroundColor: skill.color }}
            aria-label={`Color: ${skill.color}`}
          />
        ) : null}
        <span className={styles.skillBadge}>skill</span>
      </span>
    </button>
  );
}
