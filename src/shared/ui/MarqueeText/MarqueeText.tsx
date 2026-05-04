/**
 * MarqueeText — single-line label that scrolls horizontally on hover
 * when its content overflows the available width.
 *
 * Behaviour:
 *   - Text fits → renders as a normal single-line label, no animation.
 *   - Text overflows → trailing ellipsis is replaced by a hover-driven
 *     marquee that scrolls left-to-right (CSS `@keyframes marquee-scroll`)
 *     and loops seamlessly via a duplicate copy of the content.
 *
 * Detection runs once on mount and again whenever `text` changes; a
 * `ResizeObserver` re-checks on container width changes so the same
 * label stops or starts scrolling as the layout reflows. The duration
 * is computed from the text width (`--marquee-duration`) so long names
 * scroll at a steady ~50 px / s rather than gallop ahead of short ones.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { cn } from "@shared/lib";

import styles from "./MarqueeText.module.css";

export interface MarqueeTextProps {
  /** Text content. The component is purely presentational. */
  text: string;
  /** Optional class merged onto the viewport element. */
  className?: string;
  /** Optional class merged onto each copy span (typography overrides). */
  textClassName?: string;
  /** Pixels-per-second scroll speed. Default 50. */
  speedPxPerSecond?: number;
}

export function MarqueeText({
  text,
  className,
  textClassName,
  speedPxPerSecond = 50,
}: MarqueeTextProps): ReactElement {
  const viewportRef = useRef<HTMLSpanElement | null>(null);
  const copyRef = useRef<HTMLSpanElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [durationSec, setDurationSec] = useState<number>(6);

  // Measure on layout, after fonts/text have settled.
  useLayoutEffect((): undefined | (() => void) => {
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy) return undefined;

    const measure = (): void => {
      const overflow = copy.scrollWidth > viewport.clientWidth + 1;
      setIsOverflowing(overflow);
      if (overflow) {
        // Track scrolls one full copy width (= scrollWidth + the gap
        // baked into `.copy`'s padding-right). We approximate using the
        // copy's scrollWidth — close enough for human perception.
        const distance = copy.scrollWidth;
        const seconds = Math.max(2, distance / speedPxPerSecond);
        setDurationSec(seconds);
      }
    };

    measure();

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(viewport);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [text, speedPxPerSecond]);

  // Re-measure when the font finishes loading (safari fontset can shift
  // metrics post-render). Cheap re-run on the same measurements.
  useEffect((): undefined | (() => void) => {
    const fonts =
      typeof document !== "undefined" && "fonts" in document
        ? (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts
        : undefined;
    if (!fonts) return undefined;
    let cancelled = false;
    void fonts.ready.then(() => {
      if (cancelled) return;
      const viewport = viewportRef.current;
      const copy = copyRef.current;
      if (!viewport || !copy) return;
      setIsOverflowing(copy.scrollWidth > viewport.clientWidth + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <span
      ref={viewportRef}
      className={cn(styles.viewport, className)}
      data-overflow={isOverflowing ? "true" : undefined}
      style={{ ["--marquee-duration" as string]: `${durationSec.toFixed(2)}s` }}
      title={text}
    >
      <span className={styles.track}>
        <span ref={copyRef} className={cn(styles.copy, textClassName)}>
          {text}
        </span>
        {/* Second copy is only mounted when overflow is detected. This
         * keeps `getByText`-style queries unambiguous when the value
         * fits, AND avoids rendering text the user can never see in
         * the static case. */}
        {isOverflowing ? (
          <span
            className={cn(styles.copy, styles.copyClone, textClassName)}
            aria-hidden="true"
          >
            {text}
          </span>
        ) : null}
      </span>
    </span>
  );
}
