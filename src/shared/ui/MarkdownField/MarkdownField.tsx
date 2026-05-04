/**
 * MarkdownField — content field with implicit view ⇄ edit modes plus
 * an editing toolbar.
 *
 * Default mode is **view**: the value is rendered through
 * `MarkdownPreview` so the user reads formatted content. Click on the
 * preview (or tab focus, or focus from the keyboard) flips the field
 * into **edit** mode — a `<textarea>` takes its place and is given
 * focus immediately, alongside a Markdown editing toolbar with the
 * common formatting affordances (bold, italic, heading, link, code,
 * lists, quote). Blurring the textarea (clicking outside, tabbing
 * away) returns the field to view mode unless focus moved into the
 * toolbar. Esc also returns to view mode without losing the in-flight
 * value.
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

interface ToolbarAction {
  /** Stable key for React + data-testid. */
  id: string;
  /** Visible button label (single character / glyph for compactness). */
  glyph: string;
  /** Tooltip / aria-label. */
  label: string;
  /** Apply the formatting transformation to the textarea contents. */
  apply: (textarea: HTMLTextAreaElement, value: string) => {
    next: string;
    selectionStart: number;
    selectionEnd: number;
  };
}

/** Wrap the current selection (or insert a placeholder if empty). */
function wrapSelection(
  before: string,
  after: string,
  placeholder: string,
): ToolbarAction["apply"] {
  return (ta, value) => {
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const inner = selected.length > 0 ? selected : placeholder;
    const next = `${value.slice(0, start)}${before}${inner}${after}${value.slice(end)}`;
    return {
      next,
      selectionStart: start + before.length,
      selectionEnd: start + before.length + inner.length,
    };
  };
}

/** Prefix every selected line (or the current line if no selection). */
function prefixLines(prefix: string): ToolbarAction["apply"] {
  return (ta, value) => {
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    // Expand selection to whole-line boundaries.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const prefixed = block
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
    const next = `${value.slice(0, lineStart)}${prefixed}${value.slice(lineEnd)}`;
    return {
      next,
      selectionStart: lineStart,
      selectionEnd: lineStart + prefixed.length,
    };
  };
}

/** Insert a Markdown link, inheriting the selection as the link text. */
function insertLink(): ToolbarAction["apply"] {
  return (ta, value) => {
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const text = selected.length > 0 ? selected : "link text";
    const link = `[${text}](https://)`;
    const next = `${value.slice(0, start)}${link}${value.slice(end)}`;
    // Place the cursor inside the URL so the user can paste/type it.
    const urlOffset = link.length - 1;
    return {
      next,
      selectionStart: start + urlOffset,
      selectionEnd: start + urlOffset,
    };
  };
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    id: "bold",
    glyph: "B",
    label: "Bold (Cmd+B)",
    apply: wrapSelection("**", "**", "bold"),
  },
  {
    id: "italic",
    glyph: "I",
    label: "Italic (Cmd+I)",
    apply: wrapSelection("*", "*", "italic"),
  },
  {
    id: "heading",
    glyph: "H",
    label: "Heading",
    apply: prefixLines("## "),
  },
  { id: "link", glyph: "🔗", label: "Link", apply: insertLink() },
  {
    id: "code",
    glyph: "</>",
    label: "Inline code",
    apply: wrapSelection("`", "`", "code"),
  },
  {
    id: "code-block",
    glyph: "{ }",
    label: "Code block",
    apply: wrapSelection("\n```\n", "\n```\n", "code"),
  },
  { id: "ul", glyph: "•", label: "Bullet list", apply: prefixLines("- ") },
  {
    id: "ol",
    glyph: "1.",
    label: "Numbered list",
    apply: prefixLines("1. "),
  },
  { id: "quote", glyph: "❝", label: "Quote", apply: prefixLines("> ") },
];

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
  const containerRef = useRef<HTMLDivElement | null>(null);

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
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        enterEdit();
      }
    },
    [enterEdit],
  );

  const handleEditKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitEdit();
        return;
      }
      // Cmd/Ctrl + B / I shortcuts mirror the toolbar.
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) return;
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        applyAction(TOOLBAR_ACTIONS[0]!);
      } else if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        applyAction(TOOLBAR_ACTIONS[1]!);
      }
    },
    // applyAction is defined below; eslint-react would flag this — but
    // applyAction depends on `value` + `onChange` which can change every
    // render, so we re-create it inline rather than memoising.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exitEdit, value, onChange],
  );

  const applyAction = (action: ToolbarAction): void => {
    const ta = textareaRef.current;
    if (!ta) return;
    const result = action.apply(ta, value);
    onChange(result.next);
    // Restore selection on the next paint so the new value is in the DOM.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  /**
   * Treat focus moves into the toolbar as STILL editing — exit only
   * when focus leaves the whole MarkdownField root. A textarea blur
   * checks `relatedTarget` against the container ref; if focus went
   * to a toolbar button, stay in edit mode.
   */
  const handleTextareaBlur = (
    event: React.FocusEvent<HTMLTextAreaElement>,
  ): void => {
    const next = event.relatedTarget as Node | null;
    if (next && containerRef.current?.contains(next)) {
      return; // focus moved to a toolbar button; stay in edit mode
    }
    exitEdit();
  };

  if (mode === "edit") {
    return (
      <div
        ref={containerRef}
        className={cn(styles.editRoot, className)}
        data-testid={testId ? `${testId}-edit-root` : undefined}
      >
        <div
          className={styles.toolbar}
          role="toolbar"
          aria-label="Markdown formatting"
          data-testid={testId ? `${testId}-toolbar` : undefined}
        >
          {TOOLBAR_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className={styles.toolbarButton}
              onMouseDown={(e) => {
                // Prevent textarea blur before the click handler runs;
                // the textarea is the source of selection state.
                e.preventDefault();
              }}
              onClick={() => applyAction(action)}
              aria-label={action.label}
              title={action.label}
              data-testid={
                testId ? `${testId}-toolbar-${action.id}` : undefined
              }
            >
              {action.glyph}
            </button>
          ))}
          <span className={styles.toolbarSpacer} />
          <button
            type="button"
            className={styles.toolbarDoneButton}
            onClick={exitEdit}
            data-testid={testId ? `${testId}-toolbar-done` : undefined}
          >
            Done
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={handleTextareaBlur}
          onKeyDown={handleEditKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          rows={rows}
          data-testid={testId}
        />
      </div>
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
      aria-label={ariaLabel ? `Edit ${ariaLabel}` : "Edit content"}
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
