/**
 * Component renderer map for `react-markdown`.
 *
 * Lives in a sibling file so `MarkdownPreview.tsx` stays focused on the
 * pipeline (memoisation + plugin wiring) and the renderer details don't
 * push the main file past the 150-line guideline.
 *
 * Every renderer strips the `node` prop (the hast node ref) before
 * spreading the rest onto a real DOM element — DOM doesn't accept arbitrary
 * objects as attributes and React 19 warns when it sees them.
 */

import type {
  AnchorHTMLAttributes,
  HTMLAttributes,
  ImgHTMLAttributes,
  InputHTMLAttributes,
} from "react";
import type { Components, ExtraProps } from "react-markdown";

import { cn } from "@shared/lib";
import styles from "./MarkdownPreview.module.css";

function MarkdownLink({
  href,
  children,
  node: _node,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.link}
    >
      {children}
    </a>
  );
}

type CodeProps = HTMLAttributes<HTMLElement> & ExtraProps;

/**
 * Distinguishes inline code from block code by inspecting the
 * `language-*` class that `remark` puts on fenced blocks. With
 * `react-markdown` v10 the legacy `inline` flag was dropped, so this
 * class-sniff is the canonical replacement.
 */
function MarkdownCode({ className, children, node: _node, ...rest }: CodeProps) {
  const isBlock = typeof className === "string" && /\blanguage-/.test(className);
  if (isBlock) {
    return (
      <code {...rest} className={cn(className, styles.code)}>
        {children}
      </code>
    );
  }
  return (
    <code {...rest} className={cn(className, styles.inlineCode)}>
      {children}
    </code>
  );
}

function MarkdownImage({
  alt,
  src,
  node: _node,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
  return (
    <img
      {...rest}
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      className={styles.image}
    />
  );
}

/**
 * GFM task-list items render as `<input type="checkbox" disabled>` inside
 * an <li>. The `disabled` attribute is mandated by the spec (read-only).
 * We tag the box with `.checkbox` so it adopts the accent colour and
 * matches the surrounding type rather than the browser default grey.
 */
function MarkdownInput({
  node: _node,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & ExtraProps) {
  if (props.type === "checkbox") {
    return (
      <input {...props} disabled className={cn(props.className, styles.checkbox)} />
    );
  }
  return <input {...props} />;
}

// Module-scoped so React/react-markdown can short-circuit on identity.
export const COMPONENTS: Components = {
  a: MarkdownLink,
  code: MarkdownCode,
  img: MarkdownImage,
  input: MarkdownInput,
  table: ({ children, node: _n, ...rest }) => (
    <div className={styles.tableWrap}>
      <table {...rest} role="table" className={styles.table}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, node: _n, ...rest }) => (
    <thead {...rest} className={styles.thead}>{children}</thead>
  ),
  th: ({ children, node: _n, ...rest }) => (
    <th {...rest} className={styles.th} scope="col">{children}</th>
  ),
  td: ({ children, node: _n, ...rest }) => (
    <td {...rest} className={styles.td}>{children}</td>
  ),
  tr: ({ children, node: _n, ...rest }) => (
    <tr {...rest} className={styles.tr}>{children}</tr>
  ),
  blockquote: ({ children, node: _n, ...rest }) => (
    <blockquote {...rest} className={styles.blockquote}>{children}</blockquote>
  ),
  pre: ({ children, node: _n, ...rest }) => (
    <pre {...rest} className={styles.pre}>{children}</pre>
  ),
  h1: ({ children, node: _n, ...rest }) => (
    <h1 {...rest} className={styles.h1}>{children}</h1>
  ),
  h2: ({ children, node: _n, ...rest }) => (
    <h2 {...rest} className={styles.h2}>{children}</h2>
  ),
  h3: ({ children, node: _n, ...rest }) => (
    <h3 {...rest} className={styles.h3}>{children}</h3>
  ),
  h4: ({ children, node: _n, ...rest }) => (
    <h4 {...rest} className={styles.h4}>{children}</h4>
  ),
  h5: ({ children, node: _n, ...rest }) => (
    <h5 {...rest} className={styles.h5}>{children}</h5>
  ),
  h6: ({ children, node: _n, ...rest }) => (
    <h6 {...rest} className={styles.h6}>{children}</h6>
  ),
  p: ({ children, node: _n, ...rest }) => (
    <p {...rest} className={styles.paragraph}>{children}</p>
  ),
  ul: ({ children, node: _n, ...rest }) => (
    <ul {...rest} className={styles.ul}>{children}</ul>
  ),
  ol: ({ children, node: _n, ...rest }) => (
    <ol {...rest} className={styles.ol}>{children}</ol>
  ),
  li: ({ children, node: _n, ...rest }) => (
    <li {...rest} className={styles.li}>{children}</li>
  ),
  hr: ({ node: _n, ...rest }) => <hr {...rest} className={styles.hr} />,
};
