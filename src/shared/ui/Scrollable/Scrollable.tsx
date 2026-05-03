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
  /**
   * Stable test id forwarded to the host element so consumers can
   * assert on the scroll boundary (e.g. dialog body, kanban scroller).
   */
  "data-testid"?: string;
}

/**
 * `Scrollable` — single source of truth for non-native scrolling.
 *
 * Wraps OverlayScrollbars with the project's design tokens applied via
 * `Scrollable.css` so every scroll area in the app — sidebar, kanban
 * scroller, dialogs, prompt panel — picks up the same look (thin
 * thumb, transparent track, auto-hides at rest).
 *
 * Usage:
 *   <Scrollable axis="y" className={styles.body}>
 *     ...content...
 *   </Scrollable>
 *
 * The host element exposes a `data-axis` attribute that mirrors the
 * `axis` prop so consumers can target the surface from CSS or tests
 * without leaking the OverlayScrollbars class API.
 */
export function Scrollable({
  children,
  axis = "y",
  className,
  visibility = "auto",
  "data-testid": dataTestId,
}: ScrollableProps): ReactElement {
  const overflow =
    axis === "x"
      ? { x: "scroll" as const, y: "hidden" as const }
      : axis === "both"
        ? { x: "scroll" as const, y: "scroll" as const }
        : { x: "hidden" as const, y: "scroll" as const };

  // OverlayScrollbarsComponent is typed as `ComponentPropsWithoutRef<'div'>`,
  // so any data-* attribute we pass lands on the host element. Only set
  // `data-testid` when the consumer explicitly opts in — undefined data-*
  // attributes show up in the DOM as the literal string "undefined".
  const dataTestIdProps =
    dataTestId !== undefined ? { "data-testid": dataTestId } : {};

  return (
    <OverlayScrollbarsComponent
      className={className}
      data-axis={axis}
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
      {...dataTestIdProps}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
