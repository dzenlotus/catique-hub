/**
 * SpaceCreateDialog — modal for creating a new space.
 *
 * Props:
 *   - `isOpen`     — controls dialog visibility.
 *   - `onClose`    — called on Cancel, successful Save, or Esc.
 *   - `onCreated`  — optional callback with the newly-created Space.
 *
 * Required fields: name, prefix. Optional fields are omitted from the
 * payload when empty — never sent as empty strings. Matches
 * `CreateSpaceArgs`.
 *
 * On success: closes the dialog, calls `onCreated`, and sets the new space
 * as the active space via `useActiveSpace()` context.
 *
 * Audit-#13: the `description` form field was removed. `Space.description`
 * is never rendered anywhere in the space view, so the input was dead. The
 * schema column stays so the field can be re-introduced if a rendering
 * surface ever consumes it.
 */

import { useState, type ReactElement } from "react";

import { useCreateSpaceMutation, validatePrefix } from "@entities/space";
import type { Space } from "@entities/space";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { Dialog, Button, IconColorPicker, Input } from "@shared/ui";

import styles from "./SpaceCreateDialog.module.css";

export interface SpaceCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (space: Space) => void;
}

/**
 * `SpaceCreateDialog` — modal dialog for creating a new space.
 */
export function SpaceCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: SpaceCreateDialogProps): ReactElement {
  // Lifted icon/color so the dialog header picker drives the create
  // payload (etalon: PromptCreateDialog / BoardCreateDialog). Spaces
  // are seeded with a neutral folder glyph so the sidebar entry has
  // a baseline icon out of the box; the user can swap or clear it.
  const [icon, setIcon] = useState<string | null>(
    "PixelContentFilesFolderOpen",
  );
  const [color, setColor] = useState<string>("");

  return (
    <Dialog
      title="Create space"
      titleLeading={
        <IconColorPicker
          value={{ icon, color: color === "" ? null : color }}
          onChange={(next) => {
            setIcon(next.icon);
            setColor(next.color ?? "");
          }}
          ariaLabel="Space icon and color"
          data-testid="space-create-dialog-appearance-picker"
        />
      }
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setIcon("PixelContentFilesFolderOpen");
          setColor("");
          onClose();
        }
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="space-create-dialog"
    >
      {() => (
        <SpaceCreateDialogContent
          icon={icon}
          color={color}
          onClose={() => {
            setIcon("PixelContentFilesFolderOpen");
            setColor("");
            onClose();
          }}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface SpaceCreateDialogContentProps {
  /** Lifted icon state (driven by the dialog header picker). */
  icon: string | null;
  /** Lifted color state (driven by the dialog header picker). */
  color: string;
  onClose: () => void;
  onCreated?: (space: Space) => void;
}

function SpaceCreateDialogContent({
  icon,
  color,
  onClose,
  onCreated,
}: SpaceCreateDialogContentProps): ReactElement {
  const createMutation = useCreateSpaceMutation();
  const { setActiveSpaceId } = useActiveSpace();

  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixError, setPrefixError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handlePrefixChange = (value: string): void => {
    setPrefix(value);
    // Validate on every keystroke so the hint appears immediately.
    setPrefixError(validatePrefix(value));
  };

  const canSubmit =
    name.trim().length > 0 &&
    prefix.trim().length > 0 &&
    validatePrefix(prefix.trim()) === null;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = name.trim();
    const trimmedPrefix = prefix.trim();

    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    const prefixValidation = validatePrefix(trimmedPrefix);
    if (prefixValidation !== null) {
      setPrefixError(prefixValidation);
      return;
    }

    type MutationArgs = Parameters<typeof createMutation.mutate>[0];
    const args: MutationArgs = { name: trimmedName, prefix: trimmedPrefix };
    if (color !== "") args.color = color;
    if (icon !== null) args.icon = icon;

    createMutation.mutate(args, {
      onSuccess: (space) => {
        setActiveSpaceId(space.id);
        onCreated?.(space);
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
          placeholder="Space name"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="space-create-dialog-name-input"
        />
      </div>

      {/* Prefix */}
      <div className={styles.section}>
        <Input
          label="Prefix"
          value={prefix}
          onChange={handlePrefixChange}
          placeholder="e.g. dev"
          className={styles.fullWidthInput}
          data-testid="space-create-dialog-prefix-input"
        />
        {prefixError !== null && prefix.length > 0 ? (
          <p
            className={styles.fieldError}
            role="alert"
            data-testid="space-create-dialog-prefix-error"
          >
            {prefixError}
          </p>
        ) : null}
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="space-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="space-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="space-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
