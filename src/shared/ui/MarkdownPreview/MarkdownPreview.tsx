/**
 * MarkdownPreview — tiny, opinionated Markdown→React renderer (~100 LOC).
 *
 * Supported constructs:
 *   - `# / ## / ###`            → h1 / h2 / h3
 *   - `**bold**`                → strong
 *   - `*italic*` / `_italic_`  → em
 *   - `` `inline code` ``      → code
 *   - ` ```...``` `             → pre > code (fenced block)
 *   - `- item` / `* item`       → ul > li
 *   - `1. item`                 → ol > li
 *   - `[text](url)`             → a (target="_blank" rel="noopener noreferrer")
 *   - `\n\n`                    → paragraph break
 *
 * NOT supported (intentionally out of scope):
 *   - Nested lists or blockquotes
 *   - Tables
 *   - HTML passthrough
 *   - Setext headings (===/ ---)
 *   - Escaped characters
 *   - Reference-style links
 *   - Strikethrough, task lists, footnotes
 *
 * Security: content is NEVER passed to dangerouslySetInnerHTML. All
 * user-supplied text is rendered via React text nodes, so HTML special
 * characters (`<`, `>`, `&`, etc.) are safely escaped by React's
 * reconciler automatically.
 *
 * If a full CommonMark implementation is needed later, swap to
 * `react-markdown` + `remark-gfm` (separate decision).
 */

import type { ReactNode } from "react";
import { cn } from "@shared/lib";
import styles from "./MarkdownPreview.module.css";

export interface MarkdownPreviewProps {
  source: string;
  className?: string;
}

// ─── Inline renderer ─────────────────────────────────────────────────────────

type InlineNode = ReactNode;

/**
 * Walk a plain string and emit React nodes for bold, italic, inline-code,
 * and links. No recursion beyond one level (nesting bold inside italic etc.
 * is out of scope).
 */
function renderInline(text: string, keyPrefix: string): InlineNode[] {
  // Patterns ordered by specificity (code first so `**` inside backticks
  // is treated as code, not bold).
  const pattern =
    /(`[^`]+`)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(\[([^\]]+)\]\(([^)]+)\))/g;

  const nodes: InlineNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    // Push literal text before the match.
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-i${i++}`;

    if (match[1] !== undefined) {
      // `inline code`
      const inner = match[1].slice(1, -1);
      nodes.push(<code key={key} className={styles.inlineCode}>{inner}</code>);
    } else if (match[2] !== undefined) {
      // **bold**
      nodes.push(<strong key={key}>{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      // *italic*
      nodes.push(<em key={key}>{match[5]}</em>);
    } else if (match[6] !== undefined) {
      // _italic_
      nodes.push(<em key={key}>{match[7]}</em>);
    } else if (match[8] !== undefined) {
      // [text](url)
      nodes.push(
        <a
          key={key}
          href={match[10]}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          {match[9]}
        </a>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Trailing literal text.
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

// ─── Block tokeniser ─────────────────────────────────────────────────────────

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; lines: string[] };

function tokenise(source: string): Block[] {
  const blocks: Block[] = [];
  const rawLines = source.split("\n");

  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i]!;

    // ── Fenced code block ──────────────────────────────────────────
    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i]!.trimStart().startsWith("```")) {
        codeLines.push(rawLines[i]!);
        i++;
      }
      i++; // consume closing ```
      blocks.push({ type: "code", lang, lines: codeLines });
      continue;
    }

    // ── Heading ────────────────────────────────────────────────────
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = Math.min(headingMatch[1]!.length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: headingMatch[2]! });
      i++;
      continue;
    }

    // ── Unordered list item ────────────────────────────────────────
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^[-*]\s+/.test(rawLines[i]!)) {
        items.push(rawLines[i]!.replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // ── Ordered list item ──────────────────────────────────────────
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i]!)) {
        items.push(rawLines[i]!.replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // ── Blank line — paragraph separator, skip ────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph: accumulate until blank line or block boundary ──
    const paraLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i]!.trim() !== "" &&
      !/^(#{1,3}\s|[-*]\s|\d+\.\s|```)/.test(rawLines[i]!)
    ) {
      paraLines.push(rawLines[i]!);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paraLines });
    }
  }

  return blocks;
}

// ─── Block renderer ───────────────────────────────────────────────────────────

function renderBlock(block: Block, idx: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = (`h${block.level}`) as "h1" | "h2" | "h3";
      const cls =
        block.level === 1
          ? styles.h1
          : block.level === 2
            ? styles.h2
            : styles.h3;
      return (
        <Tag key={idx} className={cls}>
          {renderInline(block.text, `h${idx}`)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={idx} className={styles.paragraph}>
          {block.lines.flatMap((line, li) => {
            const nodes = renderInline(line, `p${idx}-l${li}`);
            return li < block.lines.length - 1 ? [...nodes, <br key={`br${li}`} />] : nodes;
          })}
        </p>
      );
    case "ul":
      return (
        <ul key={idx} className={styles.ul}>
          {block.items.map((item, ii) => (
            <li key={ii} className={styles.li}>
              {renderInline(item, `ul${idx}-li${ii}`)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={idx} className={styles.ol}>
          {block.items.map((item, ii) => (
            <li key={ii} className={styles.li}>
              {renderInline(item, `ol${idx}-li${ii}`)}
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre key={idx} className={styles.pre}>
          <code className={styles.code}>{block.lines.join("\n")}</code>
        </pre>
      );
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MarkdownPreview({ source, className }: MarkdownPreviewProps) {
  const blocks = tokenise(source);
  return (
    <div className={cn(styles.root, className)}>
      {blocks.map((block, idx) => renderBlock(block, idx))}
    </div>
  );
}
