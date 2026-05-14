/**
 * PromptEditor — prompt detail / edit modal.
 *
 * Props:
 *   - `promptId` — null → dialog closed; string → dialog open for that prompt.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { usePrompt, useUpdatePromptMutation } from "@entities/prompt";
import {
  Dialog,
  EditorShell,
  Button,
  Input,
  MarkdownField,
  IconColorPicker,
} from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";
import { PromptTagsField } from "@widgets/prompt-tags-field";

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
 *
 * The IconColorPicker lives in the dialog's `titleLeading` slot —
 * matching `<PromptEditorPanel>` so appearance always sits to the
 * LEFT of the title.
 */
export function PromptEditor({ promptId, onClose }: PromptEditorProps): ReactElement {
  const isOpen = promptId !== null;

  // Icon/color state is lifted here so the dialog header (rendered
  // outside `DialogContent`) can drive the same draft the body reads
  // back. `<PromptEditorContent>` seeds these on promptId change.
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string>("");

  return (
    <Dialog
      title="Prompt"
      titleLeading={
        promptId !== null ? (
          <IconColorPicker
            value={{ icon, color: color === "" ? null : color }}
            onChange={(next) => {
              setIcon(next.icon);
              setColor(next.color ?? "");
            }}
            ariaLabel="Prompt icon and color"
            data-testid="prompt-editor-appearance-picker"
          />
        ) : undefined
      }
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
          <PromptEditorContent
            promptId={promptId}
            icon={icon}
            color={color}
            setIcon={setIcon}
            setColor={setColor}
            onClose={onClose}
          />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptEditorContentProps {
  promptId: string;
  /** Lifted icon state (shared with the dialog header picker). */
  icon: string | null;
  /** Lifted color state (shared with the dialog header picker). */
  color: string;
  setIcon: (next: string | null) => void;
  setColor: (next: string) => void;
  onClose: () => void;
}

function PromptEditorContent({
  promptId,
  icon: localIcon,
  color: localColor,
  setIcon: setLocalIcon,
  setColor: setLocalColor,
  onClose,
}: PromptEditorContentProps): ReactElement {
  const query = usePrompt(promptId);
  const updateMutation = useUpdatePromptMutation();
  const { pushToast } = useToast();

  // Local edit state — initialised from the loaded prompt. Icon and
  // color are owned by the parent so the dialog header picker can drive
  // them; everything else stays local.
  const [localName, setLocalName] = useState("");
  const [localShortDescription, setLocalShortDescription] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when prompt data loads or promptId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalShortDescription(query.data.shortDescription ?? "");
      setLocalColor(query.data.color ?? "");
      setLocalIcon(query.data.icon ?? null);
      setLocalContent(query.data.content);
      setSaveError(null);
    }
    // setLocalColor / setLocalIcon are stable identities passed from the
    // parent — including them in deps is correct but doesn't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <EditorShell.Footer className={styles.footer}>
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
        </EditorShell.Footer>
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
        <EditorShell.Footer className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-cancel"
          >
            Close
          </Button>
        </EditorShell.Footer>
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
        <EditorShell.Footer className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-cancel"
          >
            Close
          </Button>
        </EditorShell.Footer>
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
    // Icon: null clears, string sets, omitted when unchanged.
    if (localIcon !== (prompt.icon ?? null)) {
      mutationArgs.icon = localIcon;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        // Stay open — let the user keep editing. Close is now opt-in
        // via Cancel / Esc / scrim click.
        pushToast("success", "Prompt saved");
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
    setLocalIcon(prompt.icon ?? null);
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

      {/* Appearance picker now lives in the dialog's `titleLeading`
          slot, not the body — same pattern as `<PromptEditorPanel>`. */}

      {/* Tags — live mutations against the existing prompt. */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Tags</p>
        <PromptTagsField promptId={prompt.id} />
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

      {/* Token count — auto-recomputed on save (round-19d). */}
      <div className={styles.tokenRow} data-testid="prompt-editor-token-row">
        <span className={styles.tokenLabel}>
          {prompt.tokenCount !== null && prompt.tokenCount > 0n
            ? `Current count: ≈${prompt.tokenCount.toString()} tokens`
            : "Current count: not computed"}
        </span>
      </div>

      {/* Footer */}
      <EditorShell.Footer className={styles.footer}>
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
      </EditorShell.Footer>
    </>
  );
}
