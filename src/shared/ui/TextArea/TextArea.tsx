import { forwardRef, useId } from "react";
import {
  FieldError,
  Label,
  TextArea as AriaTextArea,
  TextField,
  Text,
  type TextFieldProps,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./TextArea.module.css";

export interface TextAreaProps
  extends Omit<TextFieldProps, "className" | "children"> {
  /** Visible label (a11y contract: WCAG 3.3.2). */
  label: string;
  /** Optional helper text rendered below the textarea. */
  description?: string;
  /** Error message — flips the field into invalid state when non-empty. */
  errorMessage?: string;
  /** Optional class merged onto the wrapper. */
  className?: string;
  /** Placeholder text. */
  placeholder?: string;
  /** Visible row count — defaults to 4. */
  rows?: number;
  /** Test identifier forwarded to the inner textarea. */
  "data-testid"?: string;
}

/**
 * `TextArea` — multi-line text field wrapping `react-aria-components`
 * `TextField` + `TextArea` + `Label` + `FieldError`. Mirrors `<Input>`
 * shape so call-sites can swap freely.
 *
 * audit-#14: replaces raw `<textarea>` elements scattered across
 * widgets so styling + a11y semantics stay consistent.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea(
    {
      label,
      description,
      errorMessage,
      className,
      placeholder,
      rows = 4,
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
        <AriaTextArea
          ref={ref}
          rows={rows}
          placeholder={placeholder ?? ""}
          className={styles.textarea}
          {...(descriptionId ? { "aria-describedby": descriptionId } : {})}
          {...(dataTestId ? { "data-testid": dataTestId } : {})}
        />
        {description ? (
          <Text
            id={descriptionId}
            slot="description"
            className={styles.description}
          >
            {description}
          </Text>
        ) : null}
        {errorMessage ? (
          <FieldError className={styles.error}>{errorMessage}</FieldError>
        ) : null}
      </TextField>
    );
  },
);
