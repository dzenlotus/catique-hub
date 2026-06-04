/*
 * SaveBar — the trailing "status + Save" action row shared by the
 * settings forms (SpaceSettings, BoardSettings; task S2.2).
 *
 * Layout: an optional inline status message pinned to the leading edge
 * (`role="alert"` for errors, `role="status"` for the transient "Saved"
 * hint) and a primary Save button pinned to the trailing edge. Only one
 * of error / saved renders at a time — error wins.
 *
 * The component is purely presentational: dirty-tracking and the
 * mutation live in the caller (react-hook-form in each settings page).
 * Test ids
 * are derived from a single `testIdPrefix` so each consuming page keeps
 * its established `<scope>-error` / `<scope>-saved` / `<scope>-save`
 * selectors.
 */

import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import { Button } from "../Button";

import styles from "./SaveBar.module.css";

export interface SaveBarProps {
  /** Inline error message; renders with `role="alert"` when set. */
  error?: string | null;
  /**
   * When true (and `error` is null) renders the transient "Saved" hint
   * with `role="status"`.
   */
  saved?: boolean;
  /** Disables the Save button (typically `!canSubmit`). */
  isDisabled?: boolean;
  /** Shows the Save button's pending spinner. */
  isPending?: boolean;
  /** Fired when the Save button is pressed. */
  onSave: () => void;
  /** Save button label. Defaults to "Save". */
  saveLabel?: string;
  /**
   * Derives test ids: `<prefix>-error`, `<prefix>-saved`, `<prefix>-save`.
   * Example: `"space-settings"`.
   */
  testIdPrefix: string;
  /** Extra class merged onto the row. */
  className?: string;
}

/**
 * `SaveBar` — status message + primary Save button row for settings
 * forms. See module doc.
 */
export function SaveBar({
  error = null,
  saved = false,
  isDisabled = false,
  isPending = false,
  onSave,
  saveLabel = "Save",
  testIdPrefix,
  className,
}: SaveBarProps): ReactElement {
  return (
    <div className={cn(styles.actions, className)}>
      {error !== null ? (
        <p
          className={styles.error}
          role="alert"
          data-testid={`${testIdPrefix}-error`}
        >
          {error}
        </p>
      ) : null}
      {error === null && saved ? (
        <p
          className={styles.savedHint}
          role="status"
          data-testid={`${testIdPrefix}-saved`}
        >
          Saved
        </p>
      ) : null}
      <Button
        variant="primary"
        size="md"
        isPending={isPending}
        isDisabled={isDisabled}
        onPress={onSave}
        data-testid={`${testIdPrefix}-save`}
      >
        {saveLabel}
      </Button>
    </div>
  );
}
