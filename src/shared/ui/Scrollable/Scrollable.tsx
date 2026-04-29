import type { ReactElement, ReactNode } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import "overlayscrollbars/overlayscrollbars.css";

import "./Scrollable.css";

export interface ScrollableProps {
  /** Content rendered inside the scroll viewport. */
  children: ReactNode;
  /**
   * Scroll axis. Defaults to `"y"` (vertical only). Pass `"x"` for the
   * horizontal kanban scroller, `"both"` when content overflows in
   * either direction.
   */
  axis?: "x" | "y" | "both";
  /** Class merged onto the OverlayScrollbars host element. */
  className?: string;
  /**
   * `auto` shows the scrollbar only on scroll/hover (Mac-style),
   * `visible` keeps it visible while the area is scrollable. Default: `auto`.
   */
  visibility?: "auto" | "visible";
}

/**
 * `Scrollable` — single source of truth for non-native scrolling.
 *
 * Wraps OverlayScrollbars with the project's design tokens applied via
 * `Scrollable.css` so every scroll area in the app — sidebar, kanban
 * scroller, dialogs, prompt panel — picks up the same look (cream-tinted
 * track, accent thumb, rounded ends matching `--radius-sm`).
 *
 * Usage:
 *   <Scrollable axis="y" className={styles.body}>
 *     ...content...
 *   </Scrollable>
 *
 * Native scroll keeps working when the consumer simply sets
 * `overflow: auto` on a child element — but reach for `Scrollable` at
 * any scroll boundary that's part of the chrome (per Round 18 brief).
 */
export function Scrollable({
  children,
  axis = "y",
  className,
  visibility = "auto",
}: ScrollableProps): ReactElement {
  const overflow =
    axis === "x"
      ? { x: "scroll" as const, y: "hidden" as const }
      : axis === "both"
        ? { x: "scroll" as const, y: "scroll" as const }
        : { x: "hidden" as const, y: "scroll" as const };

  return (
    <OverlayScrollbarsComponent
      className={className}
      defer
      options={{
        overflow,
        scrollbars: {
          theme: "catique-os",
          autoHide: visibility === "auto" ? "leave" : "never",
          autoHideDelay: 600,
          dragScroll: true,
          clickScroll: true,
        },
      }}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
