/**
 * McpToolDetailPanel — content pane when a tool row is selected in the
 * rail (route `/mcp-servers/:serverId/tools/:toolId`). Round-22:
 * replaces the per-row schema toggle inside `<McpServerSection>`.
 *
 * Shows the tool's name, qualified upstream name (when present), the
 * description, and a collapsible JSON preview of the input schema.
 * Soft-deleted tools (`lastSyncedAt === null`) render with a
 * strikethrough title and a banner so reviewers know the upstream
 * dropped the tool.
 */

import {
  useId,
  useMemo,
  useState,
  type ReactElement,
} from "react";

import { useMcpToolsByServer } from "@entities/mcp-server";
import { cn } from "@shared/lib";
import type { McpTool } from "@bindings/McpTool";

import styles from "./McpServersPage.module.css";

export interface McpToolDetailPanelProps {
  serverId: string;
  toolId: string;
}

export function McpToolDetailPanel({
  serverId,
  toolId,
}: McpToolDetailPanelProps): ReactElement {
  const toolsQuery = useMcpToolsByServer(serverId);

  if (toolsQuery.status === "pending") {
    return (
      <div
        className={styles.detailRoot}
        data-testid={`mcp-servers-page-tool-loading-${toolId}`}
      >
        <p className={styles.detailMuted}>Loading tool…</p>
      </div>
    );
  }

  if (toolsQuery.status === "error") {
    return (
      <div
        className={styles.detailRoot}
        data-testid={`mcp-servers-page-tool-error-${toolId}`}
        role="alert"
      >
        <p className={styles.detailError}>
          Failed to load tools: {toolsQuery.error.message}
        </p>
      </div>
    );
  }

  const tool = toolsQuery.data.find((t) => t.id === toolId);

  if (!tool) {
    return (
      <div
        className={styles.detailRoot}
        data-testid={`mcp-servers-page-tool-missing-${toolId}`}
      >
        <p className={styles.detailMuted}>
          Tool not found. It may have been removed in a recent refresh.
        </p>
      </div>
    );
  }

  return <McpToolDetailBody tool={tool} />;
}

// ─────────────────────────────────────────────────────────────────────────────

interface McpToolDetailBodyProps {
  tool: McpTool;
}

function McpToolDetailBody({ tool }: McpToolDetailBodyProps): ReactElement {
  const [isSchemaOpen, setIsSchemaOpen] = useState(false);
  const schemaPanelId = useId();

  const isSoftDeleted = tool.lastSyncedAt === null;
  const softDeletedLabel = "Removed in upstream";

  const prettySchema = useMemo<string>(() => {
    try {
      return JSON.stringify(JSON.parse(tool.schemaJson), null, 2);
    } catch {
      return tool.schemaJson;
    }
  }, [tool.schemaJson]);

  return (
    <div
      className={styles.detailRoot}
      data-testid={`mcp-servers-page-tool-detail-${tool.id}`}
    >
      <header className={styles.detailHeader}>
        <h1
          className={cn(
            styles.detailTitle,
            isSoftDeleted ? styles.toolNameSoftDeleted : null,
          )}
          {...(isSoftDeleted
            ? { title: softDeletedLabel, "aria-label": softDeletedLabel }
            : {})}
          data-testid={`mcp-servers-page-tool-name-${tool.id}`}
        >
          {tool.name}
        </h1>
      </header>

      {tool.upstreamName && tool.upstreamName !== tool.name ? (
        <p
          className={styles.detailMeta}
          data-testid={`mcp-servers-page-tool-upstream-${tool.id}`}
        >
          Upstream name: <code>{tool.upstreamName}</code>
        </p>
      ) : null}

      {isSoftDeleted ? (
        <p
          className={styles.softDeletedBanner}
          role="status"
          data-testid={`mcp-servers-page-tool-removed-${tool.id}`}
        >
          This tool was removed in the most recent upstream refresh.
          Existing role attachments still point at it but new calls
          will fail.
        </p>
      ) : null}

      {tool.description ? (
        <p
          className={styles.toolDescription}
          data-testid={`mcp-servers-page-tool-description-${tool.id}`}
        >
          {tool.description}
        </p>
      ) : (
        <p className={styles.detailMuted}>No description provided.</p>
      )}

      <div className={styles.schemaSection}>
        <button
          type="button"
          className={styles.toolChevron}
          aria-expanded={isSchemaOpen}
          aria-controls={schemaPanelId}
          onClick={() => setIsSchemaOpen((v) => !v)}
          data-testid={`mcp-servers-page-tool-toggle-${tool.id}`}
        >
          {isSchemaOpen ? "Hide schema" : "Show schema"}
        </button>
        {isSchemaOpen ? (
          <pre
            id={schemaPanelId}
            className={styles.schemaPreview}
            data-testid={`mcp-servers-page-tool-schema-${tool.id}`}
          >
            {prettySchema}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
