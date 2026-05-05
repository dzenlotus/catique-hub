/**
 * MarkdownField — content field with implicit view ⇄ edit modes plus
 * a grouped Markdown formatting toolbar.
 *
 * Default mode is **view**: the value is rendered through
 * `MarkdownPreview`. Edit mode is entered explicitly via **click**,
 * **Enter**, or **Space** on the focused preview — bare keyboard
 * focus (e.g. tabbing through a form) only paints the focus ring,
 * it never flips the mode. This keeps tab order predictable when
 * the field is one of several inputs on a page.
 *
 * Once in edit mode a `<textarea>` takes the preview's place and is
 * given focus immediately, alongside the toolbar (sticky at the top
 * of the edit surface so it stays visible while the textarea grows).
 *
 * Toolbar UX (round-19d redesign):
 *   - Logical groups separated by thin dividers (text · heading ·
 *     list · code · block · link). Mirrors what tooling like
 *     GitHub's editor, Obsidian, and Notion settle on.
 *   - Each control has a tooltip (browser title attr) carrying the
 *     human label + keyboard shortcut.
 *   - Icon-style glyphs sized to a uniform 28×28 hit target. Where a
 *     dedicated SVG exists in the Pixel set we use it; otherwise we
 *     fall back to a typographic glyph styled with the appropriate
 *     family (`B`, `I`, `H1`/`H2`/`H3` etc).
 *   - Cmd/Ctrl+B and Cmd/Ctrl+I shortcuts mirror the toolbar.
 *   - Esc returns to view mode without discarding the value.
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
  type ReactNode,
} from "react";

import { MarkdownPreview } from "@shared/ui/MarkdownPreview";
import {
  PixelInterfaceEssentialLink,
  PixelInterfaceEssentialList,
  PixelCodingAppsWebsitesProgrammingHoldCode,
} from "@shared/ui/Icon";
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
  /** Optional listener for mode transitions. */
  onModeChange?: (mode: MarkdownFieldMode) => void;
  /** Optional class merged onto the root element. */
  className?: string;
  /** `data-testid` forwarded to the active sub-element (textarea / preview). */
  "data-testid"?: string;
}

interface ToolbarAction {
  id: string;
  /** Visible glyph or icon. */
  glyph: ReactNode;
  /** Optional small className for typographic glyph rendering. */
  glyphClass?: string;
  label: string;
  apply: (textarea: HTMLTextAreaElement, value: string) => {
    next: string;
    selectionStart: number;
    selectionEnd: number;
  };
}

interface ToolbarGroup {
  id: string;
  actions: ToolbarAction[];
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
    const urlOffset = link.length - 1;
    return {
      next,
      selectionStart: start + urlOffset,
      selectionEnd: start + urlOffset,
    };
  };
}

/** Insert a horizontal rule on a fresh line. */
function insertRule(): ToolbarAction["apply"] {
  return (ta, value) => {
    const start = ta.selectionStart ?? value.length;
    const before = value.slice(0, start);
    const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
    const insert = `${needsLeadingNewline ? "\n" : ""}\n---\n`;
    const next = `${before}${insert}${value.slice(start)}`;
    const cursor = start + insert.length;
    return { next, selectionStart: cursor, selectionEnd: cursor };
  };
}

const TOOLBAR_GROUPS: ToolbarGroup[] = [
  {
    id: "text",
    actions: [
      {
        id: "bold",
        glyph: "B",
        glyphClass: "glyphBold",
        label: "Bold (⌘B)",
        apply: wrapSelection("**", "**", "bold"),
      },
      {
        id: "italic",
        glyph: "I",
        glyphClass: "glyphItalic",
        label: "Italic (⌘I)",
        apply: wrapSelection("*", "*", "italic"),
      },
      {
        id: "strike",
        glyph: "S",
        glyphClass: "glyphStrike",
        label: "Strikethrough",
        apply: wrapSelection("~~", "~~", "strike"),
      },
    ],
  },
  {
    id: "heading",
    actions: [
      {
        id: "h1",
        glyph: "H1",
        glyphClass: "glyphHeading",
        label: "Heading 1",
        apply: prefixLines("# "),
      },
      {
        id: "h2",
        glyph: "H2",
        glyphClass: "glyphHeading",
        label: "Heading 2",
        apply: prefixLines("## "),
      },
      {
        id: "h3",
        glyph: "H3",
        glyphClass: "glyphHeading",
        label: "Heading 3",
        apply: prefixLines("### "),
      },
    ],
  },
  {
    id: "list",
    actions: [
      {
        id: "ul",
        glyph: <PixelInterfaceEssentialList width={16} height={16} aria-hidden />,
        label: "Bullet list",
        apply: prefixLines("- "),
      },
      {
        id: "ol",
        glyph: "1.",
        glyphClass: "glyphMono",
        label: "Numbered list",
        apply: prefixLines("1. "),
      },
      {
        id: "quote",
        glyph: "❝",
        glyphClass: "glyphQuote",
        label: "Quote",
        apply: prefixLines("> "),
      },
    ],
  },
  {
    id: "code",
    actions: [
      {
        id: "inline-code",
        glyph: (
          <PixelCodingAppsWebsitesProgrammingHoldCode
            width={16}
            height={16}
            aria-hidden
          />
        ),
        label: "Inline code",
        apply: wrapSelection("`", "`", "code"),
      },
      {
        id: "code-block",
        glyph: "```",
        glyphClass: "glyphMono",
        label: "Code block",
        apply: wrapSelection("\n```\n", "\n```\n", "code"),
      },
    ],
  },
  {
    id: "link",
    actions: [
      {
        id: "link",
        glyph: <PixelInterfaceEssentialLink width={16} height={16} aria-hidden />,
        label: "Link",
        apply: insertLink(),
      },
      {
        id: "hr",
        glyph: "—",
        glyphClass: "glyphMono",
        label: "Horizontal rule",
        apply: insertRule(),
      },
    ],
  },
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

  const applyAction = (action: ToolbarAction): void => {
    const ta = textareaRef.current;
    if (!ta) return;
    const result = action.apply(ta, value);
    onChange(result.next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  const handleEditKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitEdit();
        return;
      }
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) return;
      // Lookup by id so the shortcut is robust against group reordering.
      const findAction = (id: string): ToolbarAction | undefined => {
        for (const group of TOOLBAR_GROUPS) {
          const found = group.actions.find((a) => a.id === id);
          if (found) return found;
        }
        return undefined;
      };
      const key = event.key.toLowerCase();
      const action =
        key === "b" ? findAction("bold") :
        key === "i" ? findAction("italic") :
        key === "k" ? findAction("link") :
        undefined;
      if (action) {
        event.preventDefault();
        applyAction(action);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exitEdit, value, onChange],
  );

  const handleTextareaBlur = (
    event: React.FocusEvent<HTMLTextAreaElement>,
  ): void => {
    const next = event.relatedTarget as Node | null;
    if (next && containerRef.current?.contains(next)) {
      return; // focus moved into the toolbar; stay in edit mode
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
          {TOOLBAR_GROUPS.map((group, index) => (
            <span key={group.id} className={styles.group} role="group">
              {index > 0 ? (
                <span className={styles.divider} aria-hidden="true" />
              ) : null}
              {group.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={styles.toolbarButton}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyAction(action)}
                  aria-label={action.label}
                  title={action.label}
                  data-testid={
                    testId ? `${testId}-toolbar-${action.id}` : undefined
                  }
                >
                  <span
                    className={cn(
                      styles.glyph,
                      action.glyphClass !== undefined &&
                        styles[action.glyphClass],
                    )}
                  >
                    {action.glyph}
                  </span>
                </button>
              ))}
            </span>
          ))}
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

  // View mode — clickable preview surface.
  // Mode is entered via click or Enter/Space on the focused button —
  // *not* on focus alone, so tabbing through a form doesn't disrupt
  // the order or steal focus into a textarea unexpectedly.
  const isEmpty = value.trim().length === 0;
  return (
    <button
      type="button"
      className={cn(styles.viewSurface, isEmpty && styles.viewSurfaceEmpty, className)}
      onClick={enterEdit}
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
