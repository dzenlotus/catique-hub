/*
 * SettingsCard — bordered card with a heading bar and a padded body,
 * shared by the settings pages (SpaceSettings General/Roles cards;
 * task S2.2). Replaces three hand-rolled `<section className="card">`
 * + `<h3 className="cardHeading">` + body div copies.
 *
 * The card wires `aria-labelledby` from the heading automatically: the
 * heading element gets `id="<headingId>"` and the section references it.
 * Pass a stable `headingId` so the relationship survives across pages.
 *
 * `<StatePanel>` is exposed as a static sub-component for the
 * loading / error / not-found guards those pages render in place of the
 * form — same bordered surface, a status message and optional action.
 */

import type { ReactElement, ReactNode } from "react";

import { cn } from "@shared/lib";

import styles from "./SettingsCard.module.css";

export interface SettingsCardProps {
  /** Card heading text. */
  heading: string;
  /** Stable id for the heading — wired into `aria-labelledby`. */
  headingId: string;
  /** Card body content. */
  children: ReactNode;
  /** Test id on the card root. */
  testId?: string;
  /** Extra class merged onto the card root. */
  className?: string;
  /** Extra class merged onto the body wrapper. */
  bodyClassName?: string;
}

/**
 * `SettingsCard` — bordered card with a heading bar + padded body.
 * See module doc.
 */
function SettingsCardRoot({
  heading,
  headingId,
  children,
  testId,
  className,
  bodyClassName,
}: SettingsCardProps): ReactElement {
  return (
    <section
      className={cn(styles.card, className)}
      aria-labelledby={headingId}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      <h3 id={headingId} className={styles.cardHeading}>
        {heading}
      </h3>
      <div className={cn(styles.cardBody, bodyClassName)}>{children}</div>
    </section>
  );
}

export interface SettingsStatePanelProps {
  /** `"status"` for loading, `"alert"` for errors. */
  role: "status" | "alert";
  /** Status message. */
  message: string;
  /** Optional trailing action (e.g. a "Back" button). */
  action?: ReactNode;
  /** Test id on the panel root. */
  testId?: string;
}

/**
 * `SettingsCard.StatePanel` — bordered status surface for the
 * loading / error / not-found guards the settings pages render before
 * the form mounts.
 */
function SettingsStatePanel({
  role,
  message,
  action,
  testId,
}: SettingsStatePanelProps): ReactElement {
  return (
    <div
      className={styles.statusPanel}
      role={role}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      <p className={styles.statusMessage}>{message}</p>
      {action}
    </div>
  );
}

type SettingsCardComponent = typeof SettingsCardRoot & {
  StatePanel: typeof SettingsStatePanel;
};

const SettingsCardWithSlots = SettingsCardRoot as SettingsCardComponent;
SettingsCardWithSlots.StatePanel = SettingsStatePanel;

export { SettingsCardWithSlots as SettingsCard };
