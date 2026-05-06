import { useId, useRef, type ChangeEvent, type ReactElement } from "react";

import { Button } from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./ColorField.module.css";

export interface ColorFieldProps {
  /** Visible label (a11y contract: WCAG 3.3.2). */
  label: string;
  /**
   * Current value — `#RRGGBB` hex string. Pass empty string for the
   * "no color" state — the component renders an "Add color" trigger
   * instead of a swatch.
   */
  value: string;
  /** Called when the user picks a color or clears it. */
  onChange: (next: string) => void;
  /** Optional helper text below the picker. */
  description?: string;
  /** Optional class merged onto the wrapper. */
  className?: string;
  /** Test identifier forwarded to the native color input. */
  "data-testid"?: string;
}

/**
 * `ColorField` — color-picker primitive.
 *
 * audit-#15: replaces `<input type="color">` callsites scattered
 * across widgets so the swatch + reset affordance render
 * consistently. Wraps the native `<input type="color">` for the OS
 * picker; renders the value as a swatch with an inline Reset button
 * when set.
 */
export function ColorField({
  label,
  value,
  onChange,
  description,
  className,
  "data-testid": dataTestId,
}: ColorFieldProps): ReactElement {
  const reactId = useId();
  const inputId = `${reactId}-input`;
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value !== "";

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    onChange(e.target.value);
  };

  const handleReset = (): void => {
    onChange("");
  };

  return (
    <div className={cn(styles.field, className)}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <div className={styles.row}>
        {hasValue ? (
          <span
            className={styles.swatch}
            style={{ backgroundColor: value }}
            aria-hidden="true"
          />
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          type="color"
          className={styles.input}
          value={hasValue ? value : "#000000"}
          onChange={handleChange}
          aria-label={label}
          {...(dataTestId ? { "data-testid": dataTestId } : {})}
        />
        {hasValue ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={handleReset}
            data-testid={
              dataTestId ? `${dataTestId}-reset` : undefined
            }
          >
            Reset
          </Button>
        ) : null}
      </div>
      {description ? (
        <p className={styles.description}>{description}</p>
      ) : null}
    </div>
  );
}
