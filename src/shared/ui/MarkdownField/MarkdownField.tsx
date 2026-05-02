/**
 * MarkdownField — content textarea with implicit view ⇄ edit modes.
 *
 * Default mode is **view**: the value is rendered through
 * `MarkdownPreview` so the user reads formatted content. Click on the
 * preview (or tab focus, or focus from the keyboard) flips the field
 * into **edit** mode — a `<textarea>` takes its place and is given
 * focus immediately. Blurring the textarea (clicking outside, tabbing
 * away) returns the field to view mode. Esc also returns to view mode
 * without losing the in-flight value.
 *
 * Closes ctq-76 item 11. Replaces the previous "Edit / Preview"
 * explicit toggle pattern (RoleEditor, PromptEditor,
 * ClientInstructionsEditor) — same end state, no toggle chrome.
 *
 * The component is fully controlled — the parent owns `value` and
 * `onChange`. We expose `onModeChange` so a parent can react to mode
 * (e.g. show a dirty-discard guard before close).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { MarkdownPreview } from "@shared/ui/MarkdownPreview";
import { cn } from "@shared/lib";

import styles from "./MarkdownField.module.css";

export type MarkdownFieldMode = "view" | "edit";

export interface MarkdownFieldProps {
  /** Current Markdown source. The component is fully controlled. */
  value: string;
  /** Called on every keystroke while in edit mode. */
  onChange: (next: string) => void;
  /** Placeholder for empty value in BOTH modes. */
  placeholder?: string;
  /** Accessible label for the textarea + the view-mode click target. */
  ariaLabel?: string;
  /** Min visible rows in edit mode (textarea `rows` attribute). Default 8. */
  rows?: number;
  /** Initial mode. Default "view". */
  defaultMode?: MarkdownFieldMode;
  /**
   * Optional listener for mode transitions. Useful when the parent
   * needs to gate close-on-Esc with a dirty-discard prompt.
   */
  onModeChange?: (mode: MarkdownFieldMode) => void;
  /** Optional class merged onto the root element. */
  className?: string;
  /** `data-testid` forwarded to the active sub-element (textarea / preview). */
  "data-testid"?: string;
}

export function MarkdownField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  rows = 8,
  defaultMode = "view",
  onModeChange,
  className,
  "data-testid": testId,
}: MarkdownFieldProps): ReactElement {
  const [mode, setMode] = useState<MarkdownFieldMode>(defaultMode);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync external mode listeners + autofocus the textarea when entering
  // edit mode. The autofocus has to wait for the textarea to mount on
  // this render — `useEffect` runs after commit so the ref is wired.
  useEffect(() => {
    onModeChange?.(mode);
    if (mode === "edit") {
      textareaRef.current?.focus();
    }
  }, [mode, onModeChange]);

  const enterEdit = useCallback((): void => {
    setMode("edit");
  }, []);

  const exitEdit = useCallback((): void => {
    setMode("view");
  }, []);

  const handleViewKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      // Enter / Space on the view-mode button enters edit mode. The
      // browser already does this for native `<button>`s, but we keep
      // the explicit handler so behaviour stays identical if the
      // root element changes shape later.
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        enterEdit();
      }
    },
    [enterEdit],
  );

  const handleEditKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      // Esc returns to view mode without discarding the in-flight value.
      // The parent is the source of truth via `value`; the textarea
      // already pushed every keystroke through `onChange`.
      if (event.key === "Escape") {
        event.preventDefault();
        exitEdit();
      }
    },
    [exitEdit],
  );

  if (mode === "edit") {
    return (
      <textarea
        ref={textareaRef}
        className={cn(styles.textarea, className)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={exitEdit}
        onKeyDown={handleEditKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={rows}
        data-testid={testId}
      />
    );
  }

  // View mode — clickable preview surface. Empty value → muted placeholder.
  const isEmpty = value.trim().length === 0;
  return (
    <button
      type="button"
      className={cn(styles.viewSurface, isEmpty && styles.viewSurfaceEmpty, className)}
      onClick={enterEdit}
      onFocus={enterEdit}
      onKeyDown={handleViewKeyDown}
      aria-label={
        ariaLabel ? `Edit ${ariaLabel}` : "Edit content"
      }
      data-testid={testId}
    >
      {isEmpty ? (
        <span className={styles.placeholder}>{placeholder ?? ""}</span>
      ) : (
        <MarkdownPreview source={value} className={styles.preview} />
      )}
    </button>
  );
}
