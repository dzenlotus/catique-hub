import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// EntityListSidebarChevron — disclosure indicator for nested rail rows.
//
// Pixel-art-friendly stroked SVG. Mirrors the shape used by
// `widgets/spaces-sidebar/ChevronIcon` so the two rails read as one
// family. Down (⌄) when expanded, right (›) when collapsed.
// ---------------------------------------------------------------------------

interface EntityListSidebarChevronProps {
  open: boolean;
}

export function EntityListSidebarChevron({
  open,
}: EntityListSidebarChevronProps): ReactElement {
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
