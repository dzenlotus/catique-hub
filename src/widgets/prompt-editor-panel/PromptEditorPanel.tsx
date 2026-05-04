/**
 * PromptEditorPanel — inline (non-modal) prompt editor.
 *
 * Renders the same form as `<PromptEditor>` but as an in-page panel
 * rather than a Dialog. Used by `<PromptsPage>` (round-19d) so picking a
 * prompt in the sidebar opens its editor in the right pane instead of
 * popping a modal.
 *
 * Props:
 *   - `promptId` — the prompt to edit (required; caller renders nothing
 *     when no prompt is selected).
 *   - `onClose`  — called on Cancel or successful Save.
 */

import { useEffect, useState, type ReactElement } from "react";

import { usePrompt, useUpdatePromptMutation } from "@entities/prompt";
import { Button, Input, MarkdownField, IconPicker } from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./PromptEditorPanel.module.css";

export interface PromptEditorPanelProps {
  /** Prompt to edit. */
  promptId: string;
  /** Called on cancel or successful save. */
  onClose: () => void;
}

export function PromptEditorPanel({
  promptId,
  onClose,
}: PromptEditorPanelProps): ReactElement {
  const query = usePrompt(promptId);
  const updateMutation = useUpdatePromptMutation();
  const { pushToast } = useToast();

  const [localName, setLocalName] = useState("");
  const [localShortDescription, setLocalShortDescription] = useState("");
  const [localColor, setLocalColor] = useState("");
  const [localIcon, setLocalIcon] = useState<string | null>(null);
  const [localContent, setLocalContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalShortDescription(query.data.shortDescription ?? "");
      setLocalColor(query.data.color ?? "");
      setLocalIcon(query.data.icon ?? null);
      setLocalContent(query.data.content);
      setSaveError(null);
    }
  }, [query.data, promptId]);

  // ── Pending ────────────────────────────────────────────────────────

  if (query.status === "pending") {
    return (
      <section
        className={styles.root}
        aria-label="Prompt editor"
        data-testid="prompt-editor-panel"
      >
        <div className={styles.scrollArea}>
          <div className={styles.section}>
            <div className={cn(styles.skeletonRow, styles.skeletonRowNarrow)} />
            <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
          </div>
          <div className={styles.section}>
            <div className={cn(styles.skeletonRow, styles.skeletonRowMedium)} />
            <div className={styles.skeletonBlock} />
          </div>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="prompt-editor-panel-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="prompt-editor-panel-save"
          >
            Save
          </Button>
        </div>
      </section>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────

  if (query.status === "error") {
    return (
      <section
        className={styles.root}
        aria-label="Prompt editor"
        data-testid="prompt-editor-panel"
      >
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="prompt-editor-panel-fetch-error"
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
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-panel-cancel"
          >
            Close
          </Button>
        </div>
      </section>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────

  if (!query.data) {
    return (
      <section
        className={styles.root}
        aria-label="Prompt editor"
        data-testid="prompt-editor-panel"
      >
        <div
          className={styles.notFoundBanner}
          role="alert"
          data-testid="prompt-editor-panel-not-found"
        >
          <p className={styles.notFoundBannerMessage}>Prompt not found.</p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-panel-cancel"
          >
            Close
          </Button>
        </div>
      </section>
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
    const resolvedShortDescription =
      localShortDescription.trim() === ""
        ? null
        : localShortDescription.trim();
    const resolvedColor = localColor === "" ? null : localColor;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: prompt.id };

    if (trimmedName !== prompt.name) {
      mutationArgs.name = trimmedName;
    }
    if (trimmedContent !== prompt.content) {
      mutationArgs.content = trimmedContent;
    }
    if (resolvedShortDescription !== prompt.shortDescription) {
      mutationArgs.shortDescription = resolvedShortDescription;
    }
    if (resolvedColor !== prompt.color) {
      mutationArgs.color = resolvedColor;
    }
    if (localIcon !== (prompt.icon ?? null)) {
      mutationArgs.icon = localIcon;
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
    setLocalName(prompt.name);
    setLocalShortDescription(prompt.shortDescription ?? "");
    setLocalColor(prompt.color ?? "");
    setLocalIcon(prompt.icon ?? null);
    setLocalContent(prompt.content);
    setSaveError(null);
    onClose();
  };

  return (
    <section
      className={styles.root}
      aria-label="Prompt editor"
      data-testid="prompt-editor-panel"
    >
      <header className={styles.header}>
        <Button
          variant="ghost"
          size="sm"
          onPress={onClose}
          data-testid="prompt-editor-panel-back"
        >
          ← Back
        </Button>
        <h2 className={styles.title}>{prompt.name}</h2>
      </header>
      <div className={styles.scrollArea}>
        {/* Name */}
        <div className={styles.section}>
          <Input
            label="Name"
            value={localName}
            onChange={setLocalName}
            placeholder="Prompt name"
            className={styles.fullWidthInput}
            data-testid="prompt-editor-panel-name-input"
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
            data-testid="prompt-editor-panel-shortdesc-input"
          />
        </div>

        {/* Icon */}
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Icon</p>
          <IconPicker
            value={localIcon}
            onChange={setLocalIcon}
            ariaLabel="Prompt icon"
            data-testid="prompt-editor-panel-icon-picker"
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
              data-testid="prompt-editor-panel-color-input"
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

        {/* Content */}
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Content</p>
          <MarkdownField
            value={localContent}
            onChange={setLocalContent}
            placeholder="Prompt content (Markdown)…"
            ariaLabel="Content"
            data-testid="prompt-editor-panel-content-textarea"
          />
        </div>

        {/* Token count — auto-recomputed on save (round-19d). */}
        <div
          className={styles.tokenRow}
          data-testid="prompt-editor-panel-token-row"
        >
          <span className={styles.tokenLabel}>
            {prompt.tokenCount !== null && prompt.tokenCount > 0n
              ? `Current count: ≈${prompt.tokenCount.toString()} tokens`
              : "Current count: not computed"}
          </span>
        </div>
      </div>

      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-editor-panel-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-editor-panel-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="prompt-editor-panel-save"
        >
          Save
        </Button>
      </div>
    </section>
  );
}
