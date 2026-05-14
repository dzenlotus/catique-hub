/**
 * RowLabelButton — canonical `<button>` body used by every rail's
 * `renderContent`. Provides the label-column typography + focus-ring
 * + click affordance so each consumer doesn't re-derive the same
 * flexbox + font tokens.
 *
 * Layout: leading visual (icon / swatch / spacer) + ellipsised label +
 * optional badge / trailing chip via children. The `<MarqueeText>`
 * label scrolls horizontally on hover when truncated — matches the
 * legacy `EntityTree` default body.
 */

import type { ReactElement, ReactNode } from "react";

import { cn } from "@shared/lib";
import { MarqueeText } from "@shared/ui/MarqueeText";

import { RowLeading } from "./RowLeading";
import styles from "./RowLabelButton.module.css";

export interface RowLabelButtonProps {
  /** Visible row text. */
  label: string;
  /** Optional leading icon (resolved via `IconRenderer`). */
  icon?: string | null;
  /** Optional leading color (tints the icon, or fills a swatch alone). */
  color?: string | null;
  /** Strike-through label (e.g. soft-deleted entity). */
  strikethrough?: boolean;
  /** Disabled state — visually + interactively suppresses the click. */
  isDisabled?: boolean;
  /** Click handler — the row's "select" action. */
  onClick?: () => void;
  /** Stable test id stamped on the button. */
  testId?: string;
  /** aria-label override (defaults to `label`). */
  ariaLabel?: string;
  /**
   * Trailing slot rendered INSIDE the button after the label — useful
   * for badges, counts, or status dots that should sit inline.
   * Trailing affordances OUTSIDE the click surface (kebab menus, etc.)
   * should be rendered as siblings of this component, not children.
   */
  children?: ReactNode;
  /** Extra class merged onto the button. */
  className?: string;
}

export function RowLabelButton({
  label,
  icon,
  color,
  strikethrough = false,
  isDisabled = false,
  onClick,
  testId,
  ariaLabel,
  children,
  className,
}: RowLabelButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={cn(styles.button, className)}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-label={ariaLabel ?? label}
      data-testid={testId}
    >
      <RowLeading icon={icon ?? null} color={color ?? null} />
      <span className={styles.labelWrap}>
        <MarqueeText
          text={label}
          className={cn(
            styles.label,
            strikethrough && styles.labelStrikethrough,
          )}
        />
        {children}
      </span>
    </button>
  );
}
