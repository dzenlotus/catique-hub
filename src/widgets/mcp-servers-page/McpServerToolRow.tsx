/**
 * McpServerToolRow — one tool inside an MCP server section.
 *
 * Soft-deleted rows (`lastSyncedAt === null`) render with a
 * strikethrough plus `title` + `aria-label` "removed in upstream" so
 * screen-readers announce the state.
 *
 * Schema preview toggles open via a chevron button. The schemaJson
 * string is pretty-printed when valid JSON; falls back to the raw
 * string when it can't be parsed (no point throwing in render).
 */

import {
  useId,
  useMemo,
  useState,
  type ReactElement,
} from "react";

import { cn } from "@shared/lib";
import type { McpTool } from "@bindings/McpTool";

import styles from "./McpServersPage.module.css";

export interface McpServerToolRowProps {
  tool: McpTool;
}

export function McpServerToolRow({
  tool,
}: McpServerToolRowProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const previewId = useId();

  const isSoftDeleted = tool.lastSyncedAt === null;

  const prettySchema = useMemo<string>(() => {
    try {
      return JSON.stringify(JSON.parse(tool.schemaJson), null, 2);
    } catch {
      return tool.schemaJson;
    }
  }, [tool.schemaJson]);

  const softDeletedLabel = "Removed in upstream";

  return (
    <li
      className={styles.toolItem}
      data-testid={`mcp-servers-page-tool-${tool.id}`}
    >
      <div className={styles.toolHeader}>
        <span
          className={cn(
            styles.toolName,
            isSoftDeleted ? styles.toolNameSoftDeleted : null,
          )}
          {...(isSoftDeleted
            ? { title: softDeletedLabel, "aria-label": softDeletedLabel }
            : {})}
          data-testid={`mcp-servers-page-tool-name-${tool.id}`}
        >
          {tool.name}
        </span>
        <button
          type="button"
          className={styles.toolChevron}
          aria-expanded={isOpen}
          aria-controls={previewId}
          onClick={() => setIsOpen((v) => !v)}
          data-testid={`mcp-servers-page-tool-toggle-${tool.id}`}
        >
          {isOpen ? "Hide schema" : "Show schema"}
        </button>
      </div>
      {tool.description ? (
        <p className={styles.toolDescription}>{tool.description}</p>
      ) : null}
      {isOpen ? (
        <pre
          id={previewId}
          className={styles.schemaPreview}
          data-testid={`mcp-servers-page-tool-schema-${tool.id}`}
        >
          {prettySchema}
        </pre>
      ) : null}
    </li>
  );
}
