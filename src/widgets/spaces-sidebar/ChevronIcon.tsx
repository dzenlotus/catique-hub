import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// Chevron — pixel-art-friendly stroked SVG used for the SPACES expand toggle.
// Sized 12×12 (visible) inside a 28×28 hit target so it doesn't blend in.
// ---------------------------------------------------------------------------

interface ChevronIconProps {
  open: boolean;
}

export function ChevronIcon({ open }: ChevronIconProps): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      shapeRendering="crispEdges"
      aria-hidden={true}
    >
      {open ? (
        // Down chevron ⌄
        <path d="M3 5 L7 9 L11 5" />
      ) : (
        // Right chevron ›
        <path d="M5 3 L9 7 L5 11" />
      )}
    </svg>
  );
}
