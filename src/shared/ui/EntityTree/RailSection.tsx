/**
 * RailSection — thin wrapper around the three boilerplate states every
 * secondary-rail section shares: section label (with optional trailing
 * slot), loading placeholder, error region, empty copy, and the `<ul>`
 * container that hosts the row children.
 *
 * The section is passive — it never renders action buttons of its own.
 * Consumers thread add / settings / filter affordances through
 * `titleTrailingNode`.
 */

import type { ReactElement, ReactNode } from "react";

import { SidebarSectionLabel } from "@shared/ui/SidebarShell";

import styles from "./EntityTree.module.css";

export interface RailSectionProps {
  /** Section label rendered uppercase via `<SidebarSectionLabel>`. */
  title?: string;
  /** Override aria-label on the section label (defaults to `title`). */
  titleAriaLabel?: string;
  /** Trailing affordances rendered after the section label. */
  titleTrailingNode?: ReactNode;
  /** Stable test id stamped on the section wrapper. */
  testIdPrefix: string;
  /** Pending state — render a skeleton instead of children. */
  isLoading?: boolean;
  /** Error message — render an alert instead of children. */
  errorMessage?: string | null;
  /** Empty-state copy when neither loading / error / has children. */
  emptyText?: string;
  /**
   * Whether the section has any items to render. When `false` the
   * empty body is shown; when `true` the children prop is rendered
   * inside a `<ul>`. The consumer is responsible for mapping data to
   * `<Row>` / `<Group>` children — RailSection just owns the
   * scaffolding around them.
   */
  isEmpty: boolean;
  /** `<Row>` / `<Group>` siblings. */
  children?: ReactNode;
}

export function RailSection({
  title,
  titleAriaLabel,
  titleTrailingNode,
  testIdPrefix,
  isLoading = false,
  errorMessage = null,
  emptyText = "Nothing here yet.",
  isEmpty,
  children,
}: RailSectionProps): ReactElement {
  return (
    <div className={styles.section} data-testid={`${testIdPrefix}-root`}>
      {title !== undefined ? (
        <SidebarSectionLabel
          ariaLabel={titleAriaLabel ?? title}
          trailing={titleTrailingNode ?? null}
        >
          {title}
        </SidebarSectionLabel>
      ) : null}

      {isLoading ? (
        <div className={styles.bodyEmpty} aria-hidden="true">
          <span className={styles.bodyEmptyText}>Loading…</span>
        </div>
      ) : errorMessage !== null ? (
        <div className={styles.bodyError} role="alert">
          {errorMessage}
        </div>
      ) : isEmpty ? (
        <div className={styles.bodyEmpty}>
          <span className={styles.bodyEmptyText}>{emptyText}</span>
        </div>
      ) : (
        <ul className={styles.list} role="list">
          {children}
        </ul>
      )}
    </div>
  );
}
