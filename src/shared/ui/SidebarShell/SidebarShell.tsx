import type { ReactElement, ReactNode } from "react";

import { cn } from "@shared/lib";
import { Scrollable } from "@shared/ui/Scrollable";
import { PixelInterfaceEssentialPlus } from "@shared/ui/Icon";

import styles from "./SidebarShell.module.css";

// ---------------------------------------------------------------------------
// SidebarShell — shared cosmetic chrome for secondary navigation rails.
// ---------------------------------------------------------------------------

/**
 * Architectural note (round-19c, prompts-page rework):
 * Option A picked. The cosmetic frame (root <aside>, scrollable wrapper,
 * section label, "+ Add ..." trigger) lives in `shared/ui/SidebarShell`
 * so both `widgets/spaces-sidebar` and `widgets/prompts-sidebar` can
 * share it without lifting any widget-specific state. Each widget keeps
 * ownership of its row markup, kebab actions, and DnD wiring.
 */

export interface SidebarShellProps {
  /** Accessible label exposed on the `<aside>` root. */
  ariaLabel: string;
  /** Stable test id assigned to the root. */
  testId?: string;
  /** Extra class merged onto the root. */
  className?: string;
  /**
   * Children render inside the scrollable section column. Consumers are
   * responsible for composing one or more `<SidebarSection>` blocks.
   */
  children: ReactNode;
}

/**
 * Root frame for a secondary navigation rail.
 *
 * Layout: full-height column with a 1-px right border and a scrollable
 * inner area. Rendered as an `<aside>` so AT users land on a labelled
 * landmark.
 */
export function SidebarShell({
  ariaLabel,
  testId,
  className,
  children,
}: SidebarShellProps): ReactElement {
  const dataTestIdProps = testId !== undefined ? { "data-testid": testId } : {};

  return (
    <aside
      className={cn(styles.sidebar, className)}
      aria-label={ariaLabel}
      {...dataTestIdProps}
    >
      <Scrollable axis="y" className={styles.sectionsWrap}>
        {children}
      </Scrollable>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

export interface SidebarSectionLabelProps {
  /** Visible text — uppercase, letter-spaced. */
  children: ReactNode;
  /** Mirrored as `aria-label` so AT picks the same string. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Uppercase label that prefixes a list section. Mirrors the look of the
 * round-20 SPACES heading.
 */
export function SidebarSectionLabel({
  children,
  ariaLabel,
  className,
}: SidebarSectionLabelProps): ReactElement {
  const labelProps =
    ariaLabel !== undefined ? { "aria-label": ariaLabel } : {};

  return (
    <div className={cn(styles.sectionLabel, className)} {...labelProps}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add row
// ---------------------------------------------------------------------------

export interface SidebarAddRowProps {
  /** Label rendered next to the "+" pixel icon. */
  label: string;
  /** Click handler — typically opens a create dialog. */
  onPress: () => void;
  /** Stable test id for the trigger. */
  testId?: string;
  /** Override aria-label (defaults to `label`). */
  ariaLabel?: string;
}

/**
 * "+ Add ..." trigger pinned at the bottom of a section. Reuses the
 * same typography as regular list rows so it reads as a peer.
 */
export function SidebarAddRow({
  label,
  onPress,
  testId,
  ariaLabel,
}: SidebarAddRowProps): ReactElement {
  const dataTestIdProps = testId !== undefined ? { "data-testid": testId } : {};

  return (
    <button
      type="button"
      className={styles.addRow}
      onClick={onPress}
      aria-label={ariaLabel ?? label}
      {...dataTestIdProps}
    >
      <PixelInterfaceEssentialPlus
        width={14}
        height={14}
        aria-hidden={true}
        className={styles.addRowIcon}
      />
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

/** Hairline divider used to split two stacked sections inside one rail. */
export function SidebarSectionDivider(): ReactElement {
  return <hr className={styles.divider} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// SidebarNavItem — unified active-row primitive.
// ---------------------------------------------------------------------------

export interface SidebarNavItemProps {
  /** Whether this entry is the current selection. Drives the active strip. */
  isActive?: boolean;
  /** Click / activate handler. */
  onClick?: () => void;
  /** Forwarded as `aria-label` on the button. */
  ariaLabel?: string;
  /** Forwarded as `data-testid` on the button. */
  testId?: string;
  /**
   * Indent depth. `0` = top-level, `1` = nested (e.g. boards under a
   * space). Affects horizontal padding only.
   */
  level?: 0 | 1;
  /**
   * Trailing slot rendered as a sibling of the button — typically a
   * kebab menu trigger. Kept outside the activation surface so the
   * menu trigger doesn't double-fire onClick.
   */
  trailing?: ReactNode;
  /** Class merged onto the row container. */
  className?: string;
  /** Class merged onto the inner button. */
  buttonClassName?: string;
  /** Inner content — typically icon + label. */
  children: ReactNode;
}

/**
 * Unified row used across sidebars to keep active highlights identical.
 * The button gets the accent-soft active background; an absolutely-
 * positioned strip marks the active row in the leading gutter. The
 * optional `trailing` slot sits beside the button as a sibling for
 * absolute positioning of menu triggers without re-triggering the
 * button onClick. When `trailing` is present the inner button reserves
 * right-padding so the label can ellipsise without sliding under it.
 */
export function SidebarNavItem({
  isActive = false,
  onClick,
  ariaLabel,
  testId,
  level = 0,
  trailing,
  className,
  buttonClassName,
  children,
}: SidebarNavItemProps): ReactElement {
  const buttonProps =
    testId !== undefined ? { "data-testid": testId } : {};
  return (
    <div className={cn(styles.navItemRow, className)}>
      {isActive ? (
        <span className={styles.activeStrip} aria-hidden="true" />
      ) : null}
      <button
        type="button"
        className={cn(
          styles.navItem,
          isActive && styles.navItemActive,
          level === 1 && styles.navItemNested,
          trailing !== undefined && styles.navItemHasTrailing,
          buttonClassName,
        )}
        {...(onClick !== undefined ? { onClick } : {})}
        {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
        aria-current={isActive ? "page" : undefined}
        {...buttonProps}
      >
        {children}
      </button>
      {trailing}
    </div>
  );
}
