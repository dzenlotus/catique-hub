import {
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@shared/lib";

import styles from "./Collapsible.module.css";

export interface CollapsibleProps {
  /** Heading text shown on the toggle row. */
  title: ReactNode;
  /** Optional supporting copy rendered below the title. */
  description?: ReactNode;
  /**
   * When `false` the content stays open and the chevron + click target
   * are not rendered — i.e. the surface degrades back to a plain card
   * shell. Defaults to `true`.
   */
  collapsible?: boolean;
  /**
   * Initial open state. Ignored when `collapsible === false`. The
   * component owns its own state — controlled mode lives behind
   * `isOpen` / `onOpenChange` if/when a caller actually needs it.
   */
  defaultOpen?: boolean;
  /** Optional trailing slot rendered on the right of the heading row. */
  trailing?: ReactNode;
  /** Class merged onto the outer card wrapper. */
  className?: string;
  /** Stable testid for the wrapper. */
  testId?: string;
  /** Body content. */
  children: ReactNode;
}

/**
 * `Collapsible` — card surface with an optional collapse toggle.
 *
 * Visually mirrors the `.card` pattern used across editor pages
 * (`BoardSettings`, `SpaceSettings`, …) so swapping a `<section>` for
 * `<Collapsible>` doesn't change the page rhythm. Pass
 * `collapsible={false}` to render the same chrome without the
 * toggle.
 */
export function Collapsible({
  title,
  description,
  collapsible = true,
  defaultOpen = true,
  trailing,
  className,
  testId,
  children,
}: CollapsibleProps): ReactElement {
  const [open, setOpen] = useState(collapsible ? defaultOpen : true);
  const headingId = useId();
  const bodyId = useId();
  const isOpen = collapsible ? open : true;

  const dataTestIdProps =
    testId !== undefined ? { "data-testid": testId } : {};

  const headingContent = (
    <>
      {collapsible ? <Chevron open={isOpen} /> : null}
      <span className={styles.headingText}>
        <span id={headingId} className={styles.headingTitle}>
          {title}
        </span>
        {description !== undefined && description !== null ? (
          <span className={styles.headingDescription}>{description}</span>
        ) : null}
      </span>
      {trailing !== undefined ? (
        <span
          className={styles.headingTrailing}
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {trailing}
        </span>
      ) : null}
    </>
  );

  return (
    <section className={cn(styles.card, className)} {...dataTestIdProps}>
      {collapsible ? (
        <button
          type="button"
          className={styles.heading}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          {headingContent}
        </button>
      ) : (
        <div className={styles.heading} role="heading" aria-level={3}>
          {headingContent}
        </div>
      )}
      <div
        id={bodyId}
        className={styles.body}
        role="region"
        aria-labelledby={headingId}
        hidden={!isOpen}
      >
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chevron — local SVG so the primitive stays self-contained. 12×12 stroked
// glyph, currentColor-tinted, rotates between right (closed) and down (open).
// ---------------------------------------------------------------------------

function Chevron({ open }: { open: boolean }): ReactElement {
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
      className={styles.chevron}
    >
      {open ? <path d="M3 5 L7 9 L11 5" /> : <path d="M5 3 L9 7 L5 11" />}
    </svg>
  );
}
