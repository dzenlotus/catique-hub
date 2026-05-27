/**
 * RoleCreateDialog — modal for creating a new role.
 *
 * Props:
 *   - `isOpen`    — controls dialog visibility.
 *   - `onClose`   — called on Cancel, successful Save, or Esc.
 *   - `onCreated` — optional callback with the newly-created Role.
 *
 * Fields: name (required), content (markdown textarea, default ""),
 * color (optional with reset).
 */

import { useState, type ReactElement } from "react";

import { useCreateRoleMutation } from "@entities/role";
import type { Role } from "@entities/role";
import { Dialog, Button, IconColorPicker, Input } from "@shared/ui";

import styles from "./RoleCreateDialog.module.css";

export interface RoleCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (role: Role) => void;
}

/**
 * `RoleCreateDialog` — modal dialog for creating a new role.
 */
export function RoleCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: RoleCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Create role"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="role-create-dialog"
    >
      {() => (
        <RoleCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface RoleCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (role: Role) => void;
}

function RoleCreateDialogContent({
  onClose,
  onCreated,
}: RoleCreateDialogContentProps): ReactElement {
  const createMutation = useCreateRoleMutation();

  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    type MutationArgs = Parameters<typeof createMutation.mutate>[0];
    const args: MutationArgs = { name: trimmedName };
    // content defaults to "" on Rust side when omitted; send only when non-empty.
    if (content !== "") args.content = content;
    if (color !== "") args.color = color;
    if (icon !== null) args.icon = icon;

    createMutation.mutate(args, {
      onSuccess: (role) => {
        onCreated?.(role);
        onClose();
      },
      onError: (err) => {
        const detail =
          err instanceof Error && err.message ? err.message : String(err);
        setSaveError(`Failed to create: ${detail}`);
      },
    });
  };

  const handleCancel = (): void => {
    onClose();
  };

  return (
    <>
      {/* Identity row: IconColorPicker on the LEFT, Name on the right.
          Mirrors PromptGroupCreateDialog (audit-D, commit db80282)
          per maintainer feedback — same layout pattern for every
          create-dialog with an IconColorPicker. */}
      <div className={styles.identityRow}>
        <IconColorPicker
          value={{ icon, color: color === "" ? null : color }}
          onChange={(next) => {
            setIcon(next.icon);
            setColor(next.color ?? "");
          }}
          ariaLabel="Role icon and color"
          data-testid="role-create-dialog-color-input"
        />
        <div className={styles.identityFields}>
          <Input
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Role name"
            autoFocus
            className={styles.fullWidthInput}
            data-testid="role-create-dialog-name-input"
          />
        </div>
      </div>

      {/* Content */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Content</p>
        <textarea
          className={styles.contentTextarea}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Role content (Markdown)…"
          data-testid="role-create-dialog-content-textarea"
          aria-label="Content"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="role-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="role-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="role-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
