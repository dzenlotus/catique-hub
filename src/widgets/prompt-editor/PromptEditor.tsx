/**
 * PromptEditor — prompt detail / edit modal.
 *
 * Props:
 *   - `promptId` — null → dialog closed; string → dialog open for that prompt.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { PixelInterfaceEssentialRefresh } from "@shared/ui/Icon";
import { usePrompt, useUpdatePromptMutation, useRecomputePromptTokenCountMutation } from "@entities/prompt";
import { Dialog, DialogFooter, Button, Input, Tooltip, TooltipTrigger, MarkdownField } from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./PromptEditor.module.css";

export interface PromptEditorProps {
  /** null = closed, string = open for this prompt id */
  promptId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `PromptEditor` — modal for viewing and editing a prompt's name, content,
 * color and short description.
 *
 * Delegates open/close tracking to `promptId` — when null the `<Dialog>`
 * `isOpen` prop is false, so RAC handles exit animations and focus restoration.
 */
export function PromptEditor({ promptId, onClose }: PromptEditorProps): ReactElement {
  const isOpen = promptId !== null;

  return (
    <Dialog
      title="Prompt"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="prompt-editor"
    >
      {() =>
        promptId !== null ? (
          <PromptEditorContent promptId={promptId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptEditorContentProps {
  promptId: string;
  onClose: () => void;
}

function PromptEditorContent({
  promptId,
  onClose,
}: PromptEditorContentProps): ReactElement {
  const query = usePrompt(promptId);
  const updateMutation = useUpdatePromptMutation();
  const recountMutation = useRecomputePromptTokenCountMutation();
  const { pushToast } = useToast();

  // Local edit state — initialised from the loaded prompt.
  const [localName, setLocalName] = useState("");
  const [localShortDescription, setLocalShortDescription] = useState("");
  const [localColor, setLocalColor] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when prompt data loads or promptId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalShortDescription(query.data.shortDescription ?? "");
      setLocalColor(query.data.color ?? "");
      setLocalContent(query.data.content);
      setSaveError(null);
    }
  }, [query.data, promptId]);

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
        <DialogFooter className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="prompt-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="prompt-editor-save"
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
          data-testid="prompt-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load prompt: {query.error.message}
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
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-cancel"
          >
            Close
          </Button>
        </DialogFooter>
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
          data-testid="prompt-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            Prompt not found.
          </p>
        </div>
        <DialogFooter className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-cancel"
          >
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const prompt = query.data;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }
    const trimmedContent = localContent.trim();
    if (!trimmedContent) {
      setSaveError("Content cannot be empty.");
      return;
    }
    // Empty string → clear to null; non-empty → use trimmed value.
    const resolvedShortDescription =
      localShortDescription.trim() === "" ? null : localShortDescription.trim();
    // Empty string → clear to null; non-empty → use value as-is.
    const resolvedColor = localColor === "" ? null : localColor;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: prompt.id };

    if (trimmedName !== prompt.name) {
      mutationArgs.name = trimmedName;
    }
    if (trimmedContent !== prompt.content) {
      mutationArgs.content = trimmedContent;
    }
    // For nullable fields: only include when the resolved value differs from stored.
    if (resolvedShortDescription !== prompt.shortDescription) {
      mutationArgs.shortDescription = resolvedShortDescription;
    }
    if (resolvedColor !== prompt.color) {
      mutationArgs.color = resolvedColor;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        pushToast("success", "Prompt saved");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Failed to save prompt: ${err.message}`);
        setSaveError(`Failed to save: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    // Reset local state back to prompt values before closing.
    setLocalName(prompt.name);
    setLocalShortDescription(prompt.shortDescription ?? "");
    setLocalColor(prompt.color ?? "");
    setLocalContent(prompt.content);
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
          placeholder="Prompt name"
          className={styles.fullWidthInput}
          data-testid="prompt-editor-name-input"
        />
      </div>

      {/* Short description */}
      <div className={styles.section}>
        <Input
          label="Short description"
          value={localShortDescription}
          onChange={setLocalShortDescription}
          placeholder="Optional short description…"
          className={styles.fullWidthInput}
          data-testid="prompt-editor-shortdesc-input"
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
            aria-label="Prompt color"
            data-testid="prompt-editor-color-input"
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

      {/* Content — implicit view ⇄ edit toggle via MarkdownField (ctq-76 #11). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Content</p>
        <MarkdownField
          value={localContent}
          onChange={setLocalContent}
          placeholder="Prompt content (Markdown)…"
          ariaLabel="Content"
          data-testid="prompt-editor-content-textarea"
        />
      </div>

      {/* Token count */}
      <div className={styles.tokenRow} data-testid="prompt-editor-token-row">
        <span className={styles.tokenLabel}>
          {prompt.tokenCount !== null && prompt.tokenCount > 0n
            ? `Current count: ≈${prompt.tokenCount.toString()} tokens`
            : "Current count: not computed"}
        </span>
        <TooltipTrigger>
          <Button
            variant="ghost"
            size="sm"
            isPending={recountMutation.status === "pending"}
            onPress={() => recountMutation.mutate(prompt.id)}
            data-testid="prompt-editor-recount-button"
            aria-label="Recount tokens"
          >
            <PixelInterfaceEssentialRefresh width={14} height={14} aria-hidden="true" />
            Recount
          </Button>
          <Tooltip>Recount tokens</Tooltip>
        </TooltipTrigger>
      </div>

      {/* Footer */}
      <DialogFooter className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="prompt-editor-save"
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
