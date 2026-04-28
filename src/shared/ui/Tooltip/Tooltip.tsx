import type { ReactElement, ReactNode } from "react";
import {
  OverlayArrow as AriaOverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
  type TooltipProps as AriaTooltipProps,
  type TooltipTriggerComponentProps as AriaTooltipTriggerProps,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Tooltip.module.css";

export interface TooltipProps extends Omit<AriaTooltipProps, "className" | "children"> {
  /** Tooltip body text or compact node. */
  children: ReactNode;
  className?: string;
  /**
   * Where the tooltip should appear relative to the trigger.
   * @default "top"
   */
  placement?: "top" | "bottom" | "left" | "right";
  /** Whether to render an arrow pointing at the trigger. @default true */
  showArrow?: boolean;
}

/**
 * `Tooltip` — RAC `Tooltip` with an optional `OverlayArrow`.
 *
 * Pair with `<TooltipTrigger>` (re-exported below). The trigger child must
 * be a focusable element (a `<Button>` from this design-system, or an
 * element wired via RAC `<FocusableProvider>`) — non-focusable triggers
 * fail the WCAG 1.4.13 hover/focus persistence contract.
 *
 * Behaviour delivered by RAC:
 *   - Show on hover (with delay) and on focus.
 *   - Hide on blur, hover-out, or Esc.
 *   - role="tooltip" with aria-describedby on the trigger.
 *
 * WCAG token-pair (tooltip surface):
 * - text on tooltip: `--color-text-default` on `--color-surface-overlay`
 *   (light: 16.5:1 → AAA; dark: 12.6:1 → AAA).
 * - tooltip is short-lived but must NOT block content; we use top-layer
 *   z-index via RAC's overlay system.
 */
export function Tooltip({
  children,
  className,
  placement = "top",
  showArrow = true,
  ...rest
}: TooltipProps): ReactElement {
  return (
    <AriaTooltip
      {...rest}
      placement={placement}
      className={cn(styles.tooltip, className)}
    >
      {showArrow ? (
        <AriaOverlayArrow className={styles.arrow}>
          <svg width={10} height={6} viewBox="0 0 10 6" aria-hidden="true">
            <path d="M0 0L5 6L10 0Z" fill="currentColor" />
          </svg>
        </AriaOverlayArrow>
      ) : null}
      <span className={styles.body}>{children}</span>
    </AriaTooltip>
  );
}

export type TooltipTriggerProps = AriaTooltipTriggerProps;

/**
 * `TooltipTrigger` — RAC re-export.
 *
 * Usage:
 *   <TooltipTrigger>
 *     <Button aria-label="Delete"><DeleteIcon /></Button>
 *     <Tooltip>Delete</Tooltip>
 *   </TooltipTrigger>
 */
export const TooltipTrigger = AriaTooltipTrigger;
