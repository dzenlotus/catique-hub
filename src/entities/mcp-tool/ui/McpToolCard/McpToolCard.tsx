import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { McpTool } from "../../model/types";

import styles from "./McpToolCard.module.css";

export interface McpToolCardProps {
  /**
   * MCP tool to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  tool?: McpTool;
  /** Click / keyboard-activate handler. Receives the tool id. */
  onSelect?: (id: string) => void;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `useMcpTools()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `McpToolCard` — presentational card for a single MCP tool.
 *
 * Vertical layout:
 *   - top: name (single line, semibold, truncated)
 *   - middle (optional): description 1-line clamp muted (when non-null)
 *   - bottom meta row: "tool" badge + optional color swatch + "JSON" hint
 *
 * Native `<button>` for activation — gets focus, Enter, Space, and
 * platform a11y semantics for free.
 */
export function McpToolCard({
  tool,
  onSelect,
  isPending = false,
  className,
}: McpToolCardProps): ReactElement {
  if (isPending || !tool) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="mcp-tool-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonName)} />
        <div className={cn(styles.skeletonLine, styles.skeletonDescription)} />
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
      </div>
    );
  }

  const hasDescription =
    tool.description !== null && tool.description.trim().length > 0;

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(tool.id)}
    >
      <span className={styles.name} title={tool.name}>
        {tool.name}
      </span>

      {hasDescription ? (
        <span className={styles.descriptionPreview}>{tool.description}</span>
      ) : null}

      <span className={styles.meta}>
        <span className={styles.toolBadge}>tool</span>
        {tool.color !== null ? (
          <span
            className={styles.colorSwatch}
            style={{ backgroundColor: tool.color }}
            aria-label={`Цвет: ${tool.color}`}
          />
        ) : null}
        <span className={styles.jsonHint}>JSON</span>
      </span>
    </button>
  );
}
