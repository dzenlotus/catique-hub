/**
 * TagEditor — tag detail / edit modal.
 *
 * Props:
 *   - `tagId`   — null → dialog closed; string → dialog open for that tag.
 *   - `onClose` — called on Cancel, successful Save, or Esc (via RAC).
 *
 * Note: the Tag binding (bindings/Tag.ts) has no `kind` field, so the
 * editor omits it entirely. Fields: name (required) + color (optional).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useTag, useUpdateTagMutation } from "@entities/tag";
import { Dialog, Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./TagEditor.module.css";

export interface TagEditorProps {
  /** null = closed, string = open for this tag id */
  tagId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `TagEditor` — modal for viewing and editing a tag's name and color.
 *
 * Delegates open/close tracking to `tagId` — when null the `<Dialog>`
 * `isOpen` prop is false, so RAC handles exit animations and focus restoration.
 */
export function TagEditor({ tagId, onClose }: TagEditorProps): ReactElement {
  const isOpen = tagId !== null;

  return (
    <Dialog
      title="Tag"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="tag-editor"
    >
      {() =>
        tagId !== null ? (
          <TagEditorContent tagId={tagId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface TagEditorContentProps {
  tagId: string;
  onClose: () => void;
}

function TagEditorContent({
  tagId,
  onClose,
}: TagEditorContentProps): ReactElement {
  const query = useTag(tagId);
  const updateMutation = useUpdateTagMutation();
  const { pushToast } = useToast();

  // Local edit state — initialised from the loaded tag.
  const [localName, setLocalName] = useState("");
  const [localColor, setLocalColor] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when tag data loads or tagId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalColor(query.data.color ?? "");
      setSaveError(null);
    }
  }, [query.data, tagId]);

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
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="tag-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="tag-editor-save"
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
          data-testid="tag-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load tag: {query.error.message}
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
            data-testid="tag-editor-cancel"
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
          data-testid="tag-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            Tag not found.
          </p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="tag-editor-cancel"
          >
            Close
          </Button>
        </div>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const tag = query.data;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    // Empty string → clear to null; non-empty → use value as-is.
    const resolvedColor = localColor === "" ? null : localColor;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: tag.id };

    if (trimmedName !== tag.name) {
      mutationArgs.name = trimmedName;
    }
    // For nullable color: only include when the resolved value differs from stored.
    if (resolvedColor !== tag.color) {
      mutationArgs.color = resolvedColor;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        pushToast("success", "Tag saved");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Failed to save tag: ${err.message}`);
        setSaveError(`Failed to save: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    // Reset local state back to tag values before closing.
    setLocalName(tag.name);
    setLocalColor(tag.color ?? "");
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
          placeholder="Tag name"
          className={styles.fullWidthInput}
          data-testid="tag-editor-name-input"
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
            aria-label="Tag color"
            data-testid="tag-editor-color-input"
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

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="tag-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="tag-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="tag-editor-save"
        >
          Save
        </Button>
      </div>
    </>
  );
}
