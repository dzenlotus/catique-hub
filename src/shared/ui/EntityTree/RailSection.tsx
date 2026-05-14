/**
 * RailSection — thin wrapper around the four boilerplate states every
 * secondary-rail section shares: section label (with optional add
 * trigger + custom trailing slot), loading placeholder, error region,
 * empty copy, and the `<ul>` container that hosts `<Row>` / `<Group>`
 * children.
 *
 * This is intentionally NOT a tree primitive — it doesn't know about
 * rows or selection. It exists so the four consumers (Roles, Skills,
 * MCP, Prompts) don't each re-implement the same scaffolding around
 * the new composable primitives.
 */

import type { ReactElement, ReactNode } from "react";

import {
  SidebarSectionAddTrigger,
  SidebarSectionLabel,
} from "@shared/ui/SidebarShell";

import styles from "./EntityTree.module.css";

export interface RailSectionProps {
  /** Section label rendered uppercase via `<SidebarSectionLabel>`. */
  title?: string;
  /** Override aria-label on the section label (defaults to `title`). */
  titleAriaLabel?: string;
  /** Extra trailing affordances rendered BEFORE the built-in "+". */
  titleTrailingNode?: ReactNode;
  /** Stable test id stamped on the section wrapper + add trigger. */
  testIdPrefix: string;
  /** Optional aria-label fallback for the add trigger; defaults to `Add ${title.toLowerCase()}`. */
  addLabel?: string;
  /** Called by the "+" trigger. Omit to hide the trigger. */
  onAdd?: () => void;
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
  addLabel,
  onAdd,
  isLoading = false,
  errorMessage = null,
  emptyText = "Nothing here yet.",
  isEmpty,
  children,
}: RailSectionProps): ReactElement {
  // Add trigger only renders once the body has loaded successfully,
  // mirroring SpacesSidebar's UX — a half-rendered rail can't fire a
  // create dialog against undefined state.
  const showAdd = onAdd !== undefined && !isLoading && errorMessage === null;

  return (
    <div className={styles.section} data-testid={`${testIdPrefix}-root`}>
      {title !== undefined ? (
        <SidebarSectionLabel
          ariaLabel={titleAriaLabel ?? title}
          trailing={
            titleTrailingNode !== undefined || showAdd ? (
              <>
                {titleTrailingNode}
                {showAdd ? (
                  <SidebarSectionAddTrigger
                    ariaLabel={addLabel ?? `Add ${title.toLowerCase()}`}
                    onPress={onAdd}
                    testId={`${testIdPrefix}-add`}
                  />
                ) : null}
              </>
            ) : null
          }
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
