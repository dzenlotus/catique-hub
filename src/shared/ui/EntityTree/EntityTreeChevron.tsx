import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// EntityTreeChevron — disclosure indicator for tree rows.
//
// Pixel-art-friendly stroked SVG. Mirrors the shape used by the
// SpacesSidebar so every rail in the app reads as one family. Down (⌄)
// when expanded, right (›) when collapsed.
// ---------------------------------------------------------------------------

interface EntityTreeChevronProps {
  open: boolean;
}

export function EntityTreeChevron({ open }: EntityTreeChevronProps): ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      shapeRendering="crispEdges"
      aria-hidden={true}
    >
      {open ? <path d="M3 5 L7 9 L11 5" /> : <path d="M5 3 L9 7 L5 11" />}
    </svg>
  );
}
