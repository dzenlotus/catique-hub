/**
 * RowLeading — canonical leading visual for a rail row.
 *
 * Slots (evaluated in order):
 *   1. `icon` + optional `color` → tinted icon at 14×14.
 *   2. `color` alone             → swatch chip at 14×14.
 *   3. Neither                   → 14×14 spacer so label columns
 *                                  stay flush across rows that have a
 *                                  leading visual and rows that don't.
 *
 * Sized 14×14 to match the row body's typography rhythm. Keep these
 * values in sync with the row's `--space-12` gap so a mixed row (icon
 * + swatch + label-only) keeps a single label column.
 */

import type { CSSProperties, ReactElement } from "react";

import { IconRenderer } from "@shared/ui/IconPicker";

import styles from "./RowLeading.module.css";

export interface RowLeadingProps {
  /** Icon registry name. */
  icon?: string | null;
  /** Hex color tinting the icon or filling the swatch. */
  color?: string | null;
}

export function RowLeading({
  icon,
  color,
}: RowLeadingProps): ReactElement {
  if (icon != null && icon !== "") {
    const style: CSSProperties | undefined =
      color != null ? { color } : undefined;
    return (
      <IconRenderer
        name={icon}
        width={14}
        height={14}
        className={styles.icon}
        {...(style !== undefined ? { style } : {})}
      />
    );
  }
  if (color != null) {
    return (
      <span
        className={styles.swatch}
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
    );
  }
  return <span className={styles.spacer} aria-hidden="true" />;
}
