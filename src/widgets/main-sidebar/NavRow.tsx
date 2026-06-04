import type { ReactElement, ReactNode } from "react";
import { cn } from "@shared/lib";

import styles from "./MainSidebar.module.css";

// ---------------------------------------------------------------------------
// NavRow — single workspace row (icon + label) used inside the main-sidebar's
// nav list. Active row gets a coloured highlight pill via CSS.
// ---------------------------------------------------------------------------

interface NavRowProps {
  isActive: boolean;
  onClick: () => void;
  "aria-current"?: "page" | undefined;
  children: ReactNode;
  className?: string;
}

export function NavRow({
  isActive,
  onClick,
  "aria-current": ariaCurrent,
  children,
  className,
}: NavRowProps): ReactElement {
  return (
    <button
      type="button"
      className={cn(styles.navItem, isActive && styles.active, className)}
      aria-current={ariaCurrent}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
