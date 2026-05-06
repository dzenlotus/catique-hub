/**
 * McpToolEditor — MCP tool detail / edit modal.
 *
 * Props:
 *   - `toolId` — null → dialog closed; string → dialog open for that tool.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useMcpTool, useUpdateMcpToolMutation } from "@entities/mcp-tool";
import { AppErrorInstance } from "@entities/board";
import { Dialog, Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./McpToolEditor.module.css";

export interface McpToolEditorProps {
  /** null = closed, string = open for this tool id */
  toolId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `McpToolEditor` — modal for viewing and editing an MCP tool's
 * name, description, schemaJson and color.
 *
 * Delegates open/close tracking to `toolId` — when null the `<Dialog>`
 * `isOpen` prop is false, so RAC handles exit animations and focus restoration.
 */
export function McpToolEditor({ toolId, onClose }: McpToolEditorProps): ReactElement {
  const isOpen = toolId !== null;

  return (
    <Dialog
      title="MCP tool"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="mcp-tool-editor"
    >
      {() =>
        toolId !== null ? (
          <McpToolEditorContent toolId={toolId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * `McpToolEditorPanel` — non-modal version mounted inline on the
 * `/mcp-tools/:mcpToolId` route per audit-#9.
 */
export function McpToolEditorPanel({
  toolId,
  onClose,
}: { toolId: string; onClose: () => void }): ReactElement {
  return (
    <div className={styles.panel} data-testid="mcp-tool-editor-panel">
      <McpToolEditorContent toolId={toolId} onClose={onClose} />
    </div>
  );
}

interface McpToolEditorContentProps {
  toolId: string;
  onClose: () => void;
}

export function McpToolEditorContent({
  toolId,
  onClose,
}: McpToolEditorContentProps): ReactElement {
  const query = useMcpTool(toolId);
  const updateMutation = useUpdateMcpToolMutation();

  // Local edit state — initialised from the loaded tool.
  const [localName, setLocalName] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const [localSchemaJson, setLocalSchemaJson] = useState("");
  const [localColor, setLocalColor] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when tool data loads or toolId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalDescription(query.data.description ?? "");
      setLocalSchemaJson(query.data.schemaJson);
      setLocalColor(query.data.color ?? "");
      setSaveError(null);
    }
  }, [query.data, toolId]);

  // ── Pending ────────────────────────────────────────────────────────

  if (query.status === "pending") {
    return (
      <>
        <div className={styles.section}>
          <div className={cn(styles.skeletonRow, styles.skeletonRowNarrow)} />
          <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
        </div>
        <div className={styles.section}>
          <div className={cn(styles.skeletonRow, styles.skeletonRowMedium)} />
          <div className={styles.skeletonBlock} />
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="mcp-tool-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="mcp-tool-editor-save"
          >
            Save
          </Button>
        </div>
      </>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────

  if (query.status === "error") {
    return (
      <>
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="mcp-tool-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load MCP tool: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="mcp-tool-editor-cancel"
          >
            Close
          </Button>
        </div>
      </>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────

  if (!query.data) {
    return (
      <>
        <div
          className={styles.notFoundBanner}
          role="alert"
          data-testid="mcp-tool-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            MCP tool not found.
          </p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="mcp-tool-editor-cancel"
          >
            Close
          </Button>
        </div>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const tool = query.data;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    const trimmedSchema = localSchemaJson.trim();
    if (!trimmedSchema) {
      setSaveError("JSON schema is required.");
      return;
    }

    // Client-side JSON validation before sending to backend.
    try {
      JSON.parse(trimmedSchema);
    } catch {
      setSaveError("Invalid JSON. Check the JSON schema syntax.");
      return;
    }

    // Empty string → clear to null; non-empty → use value as-is.
    const resolvedDescription = localDescription === "" ? null : localDescription;
    const resolvedColor = localColor === "" ? null : localColor;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: tool.id };

    if (trimmedName !== tool.name) {
      mutationArgs.name = trimmedName;
    }
    if (trimmedSchema !== tool.schemaJson) {
      mutationArgs.schemaJson = trimmedSchema;
    }
    // For nullable description: only include when the resolved value differs from stored.
    if (resolvedDescription !== tool.description) {
      mutationArgs.description = resolvedDescription;
    }
    // For nullable color: only include when the resolved value differs from stored.
    if (resolvedColor !== tool.color) {
      mutationArgs.color = resolvedColor;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        onClose();
      },
      onError: (err) => {
        if (
          err instanceof AppErrorInstance &&
          err.kind === "conflict"
        ) {
          setSaveError("Name already taken.");
        } else {
          setSaveError(`Failed to save: ${err.message}`);
        }
      },
    });
  };

  const handleCancel = (): void => {
    // Reset local state back to tool values before closing.
    setLocalName(tool.name);
    setLocalDescription(tool.description ?? "");
    setLocalSchemaJson(tool.schemaJson);
    setLocalColor(tool.color ?? "");
    setSaveError(null);
    onClose();
  };

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Name"
          value={localName}
          onChange={setLocalName}
          placeholder="Tool name"
          className={styles.fullWidthInput}
          data-testid="mcp-tool-editor-name-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <Input
          label="Description"
          value={localDescription}
          onChange={setLocalDescription}
          placeholder="Short description (optional)"
          className={styles.fullWidthInput}
          data-testid="mcp-tool-editor-description-input"
        />
      </div>

      {/* Color */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Color</p>
        <div className={styles.colorRow}>
          {localColor !== "" && (
            <span
              className={styles.colorSwatch}
              style={{ backgroundColor: localColor }}
              aria-hidden="true"
            />
          )}
          <input
            type="color"
            className={styles.colorInput}
            value={localColor === "" ? "#000000" : localColor}
            onChange={(e) => setLocalColor(e.target.value)}
            aria-label="Tool color"
            data-testid="mcp-tool-editor-color-input"
          />
          {localColor !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setLocalColor("")}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Schema JSON */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>JSON schema</p>
        <textarea
          className={styles.schemaTextarea}
          value={localSchemaJson}
          onChange={(e) => setLocalSchemaJson(e.target.value)}
          placeholder="{}"
          data-testid="mcp-tool-editor-schema-input"
          aria-label="JSON schema"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="mcp-tool-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="mcp-tool-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="mcp-tool-editor-save"
        >
          Save
        </Button>
      </div>
    </>
  );
}
