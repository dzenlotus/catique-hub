import { forwardRef, useId } from "react";
import {
  FieldError,
  Input as AriaInput,
  Label,
  TextField,
  Text,
  type TextFieldProps,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Input.module.css";

export interface InputProps
  extends Omit<TextFieldProps, "className" | "children"> {
  /**
   * Visible label. Required for a11y — RAC `<Label>` wires `htmlFor`/`id`
   * automatically against the inner `<input>`. Visually-hidden labels are
   * NOT supported on this primitive — every form field needs a visible
   * label per WCAG 3.3.2.
   */
  label: string;
  /** Optional helper text rendered below the input (and above any error). */
  description?: string;
  /**
   * Error message. When non-empty, sets `isInvalid=true` and renders
   * `<FieldError>` (aria-described / role="alert"). Pass empty string or
   * `undefined` to clear.
   */
  errorMessage?: string;
  /** Optional class merged onto the wrapper. */
  className?: string;
  /** Placeholder forwarded to the inner `<input>`. */
  placeholder?: string;
  /** Native input type — defaults to "text". */
  type?: "text" | "email" | "password" | "search" | "tel" | "url";
  /** Test identifier forwarded to the inner `<input>` element. */
  "data-testid"?: string;
}

/**
 * `Input` — single-line text field wrapping `react-aria-components`
 * `TextField` + `Input` + `Label` + `FieldError`.
 *
 * The component always renders a visible `<Label>` (a11y contract: WCAG
 * 3.3.2 Labels or Instructions). Pass `errorMessage` to flip the field
 * into an invalid state — RAC will announce it via the live region.
 *
 * WCAG token-pairs:
 * - input text:    --color-text-default on --color-surface-raised
 *                  (light: 16.5:1 → AAA; dark: 12.6:1 → AAA).
 * - placeholder:   --color-text-subtle on --color-surface-raised
 *                  (light: 6.7:1 → AA-large pass; dark: 5.07:1 → AA pass).
 * - error border:  --color-status-danger ≥3:1 against canvas (UI element
 *                  contrast WCAG 1.4.11).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    description,
    errorMessage,
    className,
    placeholder,
    type = "text",
    "data-testid": dataTestId,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const descriptionId = description ? `${reactId}-desc` : undefined;
  const isInvalid = Boolean(errorMessage);

  return (
    <TextField
      {...rest}
      isInvalid={isInvalid}
      className={cn(styles.field, className)}
    >
      <Label className={styles.label}>{label}</Label>
      <AriaInput
        ref={ref}
        type={type}
        placeholder={placeholder ?? ""}
        className={styles.input}
        {...(descriptionId ? { "aria-describedby": descriptionId } : {})}
        {...(dataTestId ? { "data-testid": dataTestId } : {})}
      />
      {description ? (
        <Text id={descriptionId} slot="description" className={styles.description}>
          {description}
        </Text>
      ) : null}
      {errorMessage ? (
        <FieldError className={styles.error}>{errorMessage}</FieldError>
      ) : null}
    </TextField>
  );
});
