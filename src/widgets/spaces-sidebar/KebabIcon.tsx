import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// Kebab — three horizontal dots, used as the per-row "more actions"
// affordance in the SPACES tree.
// ---------------------------------------------------------------------------

export function KebabIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden={true}
    >
      <circle cx="4" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12" cy="8" r="1.25" />
    </svg>
  );
}
