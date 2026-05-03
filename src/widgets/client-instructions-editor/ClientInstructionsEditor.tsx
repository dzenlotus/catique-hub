/**
 * ClientInstructionsEditor — modal for viewing and editing the global
 * instructions file for a connected agentic client (ctq-68).
 *
 * Props:
 *   - `clientId`    — null → dialog closed; string → open for that client.
 *   - `displayName` — human-readable name shown in the dialog title.
 *   - `onClose`     — called when the dialog should close.
 *
 * Semantics:
 *   - ONE-WAY: no auto-watch, no polling. Manual "Reload" only.
 *   - Dirty-discard confirmation on "Close" and "Reload".
 *   - "Changed externally" warning when `modifiedAt` drifts between mount
 *     and save attempt. Checked once on save (no polling).
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useClientInstructions, useWriteClientInstructionsMutation } from "@entities/connected-client";
import { Dialog, DialogFooter, Button, MarkdownField } from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./ClientInstructionsEditor.module.css";

export interface ClientInstructionsEditorProps {
  /** null = closed, string = open for this client id. */
  clientId: string | null;
  /** Human-readable name for the dialog title. */
  displayName: string;
  /** Called on close (cancel, successful save, Esc). */
  onClose: () => void;
}

/**
 * Controlled dialog shell. Delegates body rendering to
 * `ClientInstructionsEditorContent` once `clientId` is non-null.
 */
export function ClientInstructionsEditor({
  clientId,
  displayName,
  onClose,
}: ClientInstructionsEditorProps): ReactElement {
  const isOpen = clientId !== null;

  return (
    <Dialog
      title={`Instructions — ${displayName}`}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="client-instructions-editor"
    >
      {() =>
        clientId !== null ? (
          <ClientInstructionsEditorContent
            clientId={clientId}
            onClose={onClose}
          />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ClientInstructionsEditorContentProps {
  clientId: string;
  onClose: () => void;
}

function ClientInstructionsEditorContent({
  clientId,
  onClose,
}: ClientInstructionsEditorContentProps): ReactElement {
  const query = useClientInstructions(clientId);
  const writeMutation = useWriteClientInstructionsMutation();
  const { pushToast } = useToast();

  // Local editable content.
  const [localContent, setLocalContent] = useState("");
  // Track modifiedAt at mount time to detect external changes.
  const mountedModifiedAt = useRef<bigint | null>(null);
  // Show "changed externally" warning when modifiedAt drifts.
  const [showExternalChangeWarning, setShowExternalChangeWarning] =
    useState(false);

  // Sync local state when data loads.
  useEffect(() => {
    if (query.data) {
      setLocalContent(query.data.content);
      if (mountedModifiedAt.current === null) {
        mountedModifiedAt.current = query.data.modifiedAt;
      }
    }
  }, [query.data]);

  // True when local content differs from what's persisted.
  const isDirty = localContent !== (query.data?.content ?? "");

  const confirmDirtyDiscard = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      "Unsaved changes will be discarded. Continue?",
    );
  }, [isDirty]);

  const handleClose = (): void => {
    if (confirmDirtyDiscard()) onClose();
  };

  const handleReload = (): void => {
    if (!confirmDirtyDiscard()) return;
    setShowExternalChangeWarning(false);
    mountedModifiedAt.current = null;
    void query.refetch();
  };

  const handleSave = (): void => {
    // Check for external change before writing.
    if (
      query.data !== undefined &&
      mountedModifiedAt.current !== null &&
      query.data.modifiedAt !== mountedModifiedAt.current
    ) {
      setShowExternalChangeWarning(true);
      // Don't abort — let the user see the warning and then proceed.
    }

    writeMutation.mutate(
      { clientId, content: localContent },
      {
        onSuccess: (fresh) => {
          // Update the mounted baseline to the newly written modifiedAt.
          mountedModifiedAt.current = fresh.modifiedAt;
          setShowExternalChangeWarning(false);
          pushToast("success", "Instructions saved");
        },
        onError: (err) => {
          pushToast("error", `Failed to save: ${err.message}`);
        },
      },
    );
  };

  // ── Pending ────────────────────────────────────────────────────────

  if (query.status === "pending") {
    return (
      <>
        <div
          className={cn(styles.skeletonLine, styles.skeletonLineMedium)}
          aria-hidden="true"
        />
        <div className={styles.skeletonBlock} aria-hidden="true" />
        <DialogFooter className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="client-instructions-editor-reload"
          >
            Reload
          </Button>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="client-instructions-editor-close"
          >
            Close
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="client-instructions-editor-save"
          >
            Save
          </Button>
        </DialogFooter>
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
          data-testid="client-instructions-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load instructions: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
        <DialogFooter className={styles.footer}>
          <div className={styles.footerLeft} />
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="client-instructions-editor-close"
          >
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  // ── Loaded (including absent-file = empty-string content) ─────────

  const instructions = query.data;

  return (
    <>
      {/* File path caption */}
      <p
        className={styles.filePath}
        title={instructions.filePath}
        data-testid="client-instructions-editor-file-path"
      >
        {instructions.filePath}
      </p>

      {/* "Changed externally" warning */}
      {showExternalChangeWarning && (
        <div
          className={styles.warningBanner}
          role="alert"
          data-testid="client-instructions-editor-external-change-warning"
        >
          <p>
            The file was changed by another program since the editor opened.
            Saving will overwrite the external changes.
          </p>
        </div>
      )}

      {/* Editor body — implicit view ⇄ edit toggle (ctq-76 #11). */}
      <MarkdownField
        value={localContent}
        onChange={setLocalContent}
        placeholder="Global instructions (Markdown)…"
        ariaLabel="Instructions content"
        data-testid="client-instructions-editor-textarea"
      />

      {/* Footer */}
      <DialogFooter className={styles.footer}>
        <div className={styles.footerLeft}>
          <Button
            variant="ghost"
            size="md"
            onPress={handleReload}
            isDisabled={writeMutation.isPending}
            data-testid="client-instructions-editor-reload"
          >
            Reload
          </Button>
        </div>
        <Button
          variant="ghost"
          size="md"
          onPress={handleClose}
          isDisabled={writeMutation.isPending}
          data-testid="client-instructions-editor-close"
        >
          Close
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={writeMutation.isPending}
          onPress={handleSave}
          data-testid="client-instructions-editor-save"
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
