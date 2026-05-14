/**
 * MarkdownPreview — full-featured CommonMark + GFM renderer.
 *
 * Backed by `react-markdown` (CommonMark) + `remark-gfm` (GitHub Flavored
 * extensions) + `rehype-highlight` (highlight.js, sync, no WASM) so rendering
 * stays a pure function of `source`. The previous bespoke regex parser was
 * replaced wholesale (audit F-05, P0) — it lacked tables, blockquotes, task
 * lists, images, strikethrough, and code highlighting.
 *
 * Coverage:
 *   - CommonMark: headings, lists, paragraphs, blockquotes, fenced & indented
 *     code, inline code, emphasis, strong, links, images, hr, soft / hard
 *     line breaks, escape sequences, reference links.
 *   - GFM: tables, task lists (`- [ ]` / `- [x]`), strikethrough (`~~`),
 *     autolinks (bare URLs).
 *   - Syntax highlighting: any language registered in `highlight.js` common
 *     bundle (auto-detected when no language is given on the fence; explicit
 *     when ``` ```lang ` is set).
 *
 * Out of scope (intentionally — common GFM ask but rare in our prompts):
 *   - Footnotes (`[^1]`) — would need `remark-gfm`'s sibling plugin
 *     `remark-footnotes`; skipped to keep bundle lean.
 *   - HTML passthrough — we deliberately do NOT enable `rehype-raw`. Sources
 *     come from local SQLite-backed prompts so XSS surface is low, but we
 *     keep the safer default until a concrete need arrives.
 *
 * Security: `react-markdown` does not use `dangerouslySetInnerHTML` for
 * Markdown text — every node is a real React element, so React's reconciler
 * escapes `<`, `>`, `&` as text. URLs are passed through the default
 * `defaultUrlTransform` which strips `javascript:` schemes.
 *
 * Renderers live in `./components.tsx` to keep this file focused on the
 * pipeline (memoisation + plugin wiring).
 */

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import { cn } from "@shared/lib";
import styles from "./MarkdownPreview.module.css";
import { COMPONENTS } from "./components";

export interface MarkdownPreviewProps {
  source: string;
  className?: string;
}

// Module-scoped so plugin arrays keep referential identity across renders.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

function MarkdownPreviewBase({ source, className }: MarkdownPreviewProps) {
  // Memoise around `source` so toolbar/edit-mode parents (which re-render on
  // every keystroke) don't repeat the AST walk for unchanged content.
  const tree = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    ),
    [source],
  );

  return (
    <div data-testid="shared-markdown-preview-root" className={cn(styles.root, className)}>
      {tree}
    </div>
  );
}

export const MarkdownPreview = memo(MarkdownPreviewBase);
