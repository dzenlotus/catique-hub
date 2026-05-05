/**
 * PromptCreateDialog — modal for creating a new prompt.
 *
 * Props:
 *   - `isOpen`     — controls dialog visibility.
 *   - `onClose`    — called on Cancel, successful Save, or Esc.
 *   - `onCreated`  — optional callback with the newly-created Prompt.
 *
 * Optional fields (color, shortDescription) are omitted from the payload
 * when empty — never sent as empty strings. Matches `CreatePromptArgs`.
 */

import { useState, type ReactElement } from "react";

import { useCreatePromptMutation } from "@entities/prompt";
import type { Prompt } from "@entities/prompt";
import { useAddPromptTagMutation } from "@entities/tag";
import { Dialog, Button, Input, IconColorPicker } from "@shared/ui";
import { PromptTagsField } from "@widgets/prompt-tags-field";

import styles from "./PromptCreateDialog.module.css";

export interface PromptCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (prompt: Prompt) => void;
  /**
   * Tag ids to attach to the newly-created prompt — typically the
   * tags currently active on the parent's filter affordance, so the
   * new prompt lands inside the same filter the user is browsing.
   */
  inheritedTagIds?: ReadonlyArray<string>;
}

/**
 * `PromptCreateDialog` — modal dialog for creating a new prompt.
 *
 * The IconColorPicker lives in the dialog's `titleLeading` slot so it
 * sits to the LEFT of the title — same pattern as `<PromptEditorPanel>`
 * and `<InlineGroupSettings>`. Appearance edits the same `icon` /
 * `color` state the create payload reads from on save.
 */
export function PromptCreateDialog({
  isOpen,
  onClose,
  onCreated,
  inheritedTagIds,
}: PromptCreateDialogProps): ReactElement {
  // Lift icon/color state up so the header picker can drive the dialog
  // body's create payload. Reset on every open so a previous draft
  // doesn't leak into a new modal.
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string>("");

  return (
    <Dialog
      title="Create prompt"
      titleLeading={
        <IconColorPicker
          value={{ icon, color: color === "" ? null : color }}
          onChange={(next) => {
            setIcon(next.icon);
            setColor(next.color ?? "");
          }}
          ariaLabel="Prompt icon and color"
          data-testid="prompt-create-dialog-appearance-picker"
        />
      }
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setIcon(null);
          setColor("");
          onClose();
        }
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="prompt-create-dialog"
    >
      {() => (
        <PromptCreateDialogContent
          icon={icon}
          color={color}
          onClose={() => {
            setIcon(null);
            setColor("");
            onClose();
          }}
          {...(onCreated !== undefined ? { onCreated } : {})}
          {...(inheritedTagIds !== undefined ? { inheritedTagIds } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptCreateDialogContentProps {
  /** Icon lifted to the parent so the header picker drives this state. */
  icon: string | null;
  /** Color lifted to the parent so the header picker drives this state. */
  color: string;
  onClose: () => void;
  onCreated?: (prompt: Prompt) => void;
  inheritedTagIds?: ReadonlyArray<string>;
}

function PromptCreateDialogContent({
  icon,
  color,
  onClose,
  onCreated,
  inheritedTagIds,
}: PromptCreateDialogContentProps): ReactElement {
  const createMutation = useCreatePromptMutation();
  const addPromptTag = useAddPromptTagMutation();

  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Tags are tracked locally in draft mode — the prompt doesn't exist
  // yet, so we can't fire `add_prompt_tag` on each toggle. The set is
  // seeded with the parent's `inheritedTagIds` (sidebar filter) so the
  // user lands inside the same filter without an extra click.
  const [tagIds, setTagIds] = useState<ReadonlyArray<string>>(
    () => inheritedTagIds ?? [],
  );

  const canSubmit = name.trim().length > 0 && content.trim().length > 0;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = name.trim();
    const trimmedContent = content.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }
    if (!trimmedContent) {
      setSaveError("Content cannot be empty.");
      return;
    }

    // Build payload — omit optional fields when empty.
    type MutationArgs = Parameters<typeof createMutation.mutate>[0];
    const args: MutationArgs = { name: trimmedName, content: trimmedContent };
    const trimmedShortDesc = shortDescription.trim();
    if (trimmedShortDesc !== "") args.shortDescription = trimmedShortDesc;
    if (color !== "") args.color = color;
    if (icon !== null) args.icon = icon;

    createMutation.mutate(args, {
      onSuccess: (prompt) => {
        // Apply the user's chosen tags (which were seeded from the
        // sidebar filter via `inheritedTagIds`). Fire-and-forget per
        // tag so a single attach-failure doesn't block the dialog
        // close — failures surface through React-Query toasts.
        for (const tagId of tagIds) {
          addPromptTag.mutate({ promptId: prompt.id, tagId });
        }
        onCreated?.(prompt);
        onClose();
      },
      onError: (err) => {
        setSaveError(`Failed to create: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    onClose();
  };

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Name"
          value={name}
          onChange={setName}
          placeholder="Prompt name"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="prompt-create-dialog-name-input"
        />
      </div>

      {/* Short description */}
      <div className={styles.section}>
        <Input
          label="Short description"
          value={shortDescription}
          onChange={setShortDescription}
          placeholder="Optional short description…"
          className={styles.fullWidthInput}
          data-testid="prompt-create-dialog-shortdesc-input"
        />
      </div>

      {/* Appearance picker now lives in the dialog header
          (`titleLeading` slot), so no in-body Appearance section. */}

      {/* Tags — draft-mode (no IPC) since the prompt isn't created
          yet. Seeded from `inheritedTagIds` (sidebar filter) so the
          new prompt lands inside the same filter automatically. */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Tags</p>
        <PromptTagsField mode="draft" value={tagIds} onChange={setTagIds} />
      </div>

      {/* Content */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Content</p>
        <textarea
          className={styles.contentTextarea}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Prompt content (Markdown)…"
          data-testid="prompt-create-dialog-content-textarea"
          aria-label="Content"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="prompt-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
