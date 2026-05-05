import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// KebabIcon — three vertical dots, the canonical "more actions" affordance.
// Used by every per-row context-menu trigger so they read as a matched set.
// ---------------------------------------------------------------------------

export interface KebabIconProps {
  /** Pixel size of the square viewBox; default 16. */
  size?: number;
  /** Aria-hidden override; default true. */
  "aria-hidden"?: boolean;
}

export function KebabIcon({
  size = 16,
  "aria-hidden": ariaHidden = true,
}: KebabIconProps = {}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden={ariaHidden}
    >
      <circle cx="8" cy="3.5" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="8" cy="12.5" r="1.25" />
    </svg>
  );
}
