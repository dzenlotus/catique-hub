import { forwardRef } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Button.module.css";

/**
 * Visual variants.
 *
 * - `primary` — high-emphasis. Warm-gold accent on light surface, used for
 *   the single most important action on a screen. Token pair:
 *   `--color-accent-fg` on `--color-accent-bg`. WCAG: targets AAA (≥7:1)
 *   for primary action per NFR-2.
 * - `secondary` — medium-emphasis. Neutral surface with strong border.
 *   Token pair: `--color-text-default` on `--color-surface-raised`. WCAG AA.
 * - `ghost` — low-emphasis, transparent background. Token pair:
 *   `--color-text-default` on `--color-bg-default` (inherits canvas). WCAG AA.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";

/**
 * Size scale.
 *
 * - `sm` — 28 px row height, body-sm typography. Inline / list contexts.
 * - `md` — 32 px row height, body typography. Default for forms / dialogs.
 * - `lg` — 40 px row height, body-lg typography. Hero / CTA.
 */
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<AriaButtonProps, "className" | "children"> {
  /** Visual emphasis. @default "secondary" */
  variant?: ButtonVariant;
  /** Sizing scale. @default "md" */
  size?: ButtonSize;
  /**
   * Loading state. When true, the button shows a spinner glyph and is
   * effectively disabled (`isDisabled` propagated to RAC). RAC keeps the
   * focus ring visible while disabled, which is the desired a11y
   * behaviour — keyboard users still know where they are.
   */
  isPending?: boolean;
  /** Optional class merged after default tokens. */
  className?: string;
  /** Plain ReactNode children — render-prop form is intentionally not exposed. */
  children?: React.ReactNode;
}

/**
 * `Button` — design-system primitive wrapping `react-aria-components`.
 *
 * Variants: `primary` / `secondary` / `ghost`.
 * Sizes:    `sm` / `md` / `lg`.
 *
 * The component forwards `ref` so `widgets/*` can attach DOM refs (e.g.
 * for popover anchors). All keyboard / focus / press behaviour comes
 * from RAC — DO NOT add custom `onKeyDown` or `tabIndex` handlers.
 *
 * WCAG contrast (computed in token-pair documentation):
 * - primary on light:  --color-accent-fg (#fff) on --color-accent-bg
 *   (#6f4d24 / gold-800) → 7.65:1 → AAA pass (NFR-2 primary action).
 * - secondary on light: warm-900 on white (raised) → 16.5:1 → AAA.
 * - ghost on light:     warm-900 on warm-50 (canvas) → 15.7:1 → AAA.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      isPending = false,
      isDisabled,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const effectivelyDisabled = Boolean(isDisabled) || isPending;

    return (
      <AriaButton
        {...rest}
        ref={ref}
        isDisabled={effectivelyDisabled}
        aria-busy={isPending || undefined}
        className={cn(
          styles.button,
          styles[variant],
          styles[size],
          className,
        )}
      >
        {isPending ? (
          <span
            aria-hidden="true"
            data-testid="button-spinner"
            className={styles.spinner}
          />
        ) : null}
        <span className={styles.label}>{children}</span>
      </AriaButton>
    );
  },
);
