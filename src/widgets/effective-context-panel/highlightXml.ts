/**
 * `highlightXml` — minimal, dependency-free XML tokenizer for the task
 * preview pane.
 *
 * The repo already ships a highlight.js theme as a small palette mapped to
 * design tokens inside `MarkdownPreview.module.css` (`.hljs-name`,
 * `.hljs-attr`, `.hljs-string`, …). `TaskXmlPreview.module.css` mirrors that
 * exact mapping, so emitting the same class names here gives the XML preview
 * theme parity with code blocks — and dark/light follows `[data-theme]` for
 * free — WITHOUT pulling highlight.js (a transitive, un-hoisted dep) into a
 * component's import graph.
 *
 * We deliberately keep the grammar tiny: tags, attribute names, quoted
 * attribute values, and text. That is the entire surface the preview emits
 * (see `renderBundleXml`), so a full XML parser would be dead weight. Every
 * input character lands in exactly one token, so joining the token `text`
 * fields reproduces the input verbatim — the `<pre>`'s `textContent` is
 * unchanged, which keeps the `task-xml-preview-body` testid + copy-paste
 * behaviour intact.
 */

export interface XmlToken {
  text: string;
  /** A `.hljs-*` class, or `null` for un-themed text (rendered as a bare string). */
  className: string | null;
}

const NAME = "hljs-name";
const ATTR = "hljs-attr";
const STRING = "hljs-string";
const PUNCT = "hljs-tag";

/**
 * Tokenize an XML string into highlight.js-classed spans. The output covers
 * the input exactly: `tokens.map((t) => t.text).join("")` === `input`.
 */
export function highlightXml(input: string): ReadonlyArray<XmlToken> {
  const tokens: XmlToken[] = [];
  let i = 0;
  const n = input.length;

  const push = (text: string, className: string | null): void => {
    if (text.length === 0) return;
    tokens.push({ text, className });
  };

  while (i < n) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      // Trailing text — no more tags.
      push(input.slice(i), null);
      break;
    }
    // Text before the tag.
    push(input.slice(i, lt), null);

    const gt = input.indexOf(">", lt);
    if (gt === -1) {
      // Unterminated `<` — emit the remainder as plain text and stop.
      push(input.slice(lt), null);
      break;
    }

    tokenizeTag(input.slice(lt, gt + 1), push);
    i = gt + 1;
  }

  return tokens;
}

/**
 * Tokenize a single `<...>` tag chunk (inclusive of the angle brackets).
 * Emits the element name, attribute names, quoted values, and punctuation.
 */
function tokenizeTag(
  tag: string,
  push: (text: string, className: string | null) => void,
): void {
  let i = 0;
  const n = tag.length;

  // Leading `<`, optional `/`.
  push("<", PUNCT);
  i = 1;
  if (tag[i] === "/") {
    push("/", PUNCT);
    i += 1;
  }

  // Element name.
  const nameStart = i;
  while (i < n && /[A-Za-z0-9_:-]/.test(tag[i] ?? "")) i += 1;
  push(tag.slice(nameStart, i), NAME);

  // Attributes + whitespace until the closing bracket.
  while (i < n) {
    const ch = tag[i] ?? "";

    if (ch === ">") {
      push(">", PUNCT);
      i += 1;
      continue;
    }
    if (ch === "/" && tag[i + 1] === ">") {
      push("/>", PUNCT);
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      const wsStart = i;
      while (i < n && /\s/.test(tag[i] ?? "")) i += 1;
      push(tag.slice(wsStart, i), null);
      continue;
    }
    if (ch === "=") {
      push("=", null);
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const valStart = i;
      i += 1;
      while (i < n && tag[i] !== quote) i += 1;
      // Include the closing quote when present.
      if (i < n) i += 1;
      push(tag.slice(valStart, i), STRING);
      continue;
    }
    // Attribute name (run of non-space, non-`=`, non-`>` characters).
    const attrStart = i;
    while (
      i < n &&
      !/\s/.test(tag[i] ?? "") &&
      tag[i] !== "=" &&
      tag[i] !== ">" &&
      !(tag[i] === "/" && tag[i + 1] === ">")
    ) {
      i += 1;
    }
    push(tag.slice(attrStart, i), ATTR);
  }
}
