/**
 * PromptGroupCreateDialog — modal for creating a new prompt group.
 *
 * Props:
 *   - `isOpen`    — controls dialog visibility.
 *   - `onClose`   — called on Cancel, successful Save, or Esc.
 *   - `onCreated` — optional callback with the newly-created PromptGroup.
 *
 * Fields: name (required), color (optional with reset).
 */

import { useCallback, useState, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useCreatePromptGroupMutation } from "@entities/prompt-group";
import type { PromptGroup } from "@entities/prompt-group";
import { Dialog, Button, IconColorPicker, Input } from "@shared/ui";

import styles from "./PromptGroupCreateDialog.module.css";

// react-hook-form schema — name required; color is picker-driven (local
// state, not a validated form field).
const promptGroupFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
});

type PromptGroupFormValues = z.infer<typeof promptGroupFormSchema>;

export interface PromptGroupCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (group: PromptGroup) => void;
}

/**
 * `PromptGroupCreateDialog` — modal dialog for creating a new prompt group.
 */
export function PromptGroupCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: PromptGroupCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Create prompt group"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="prompt-group-create-dialog"
    >
      {() => (
        <PromptGroupCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptGroupCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (group: PromptGroup) => void;
}

function PromptGroupCreateDialogContent({
  onClose,
  onCreated,
}: PromptGroupCreateDialogContentProps): ReactElement {
  const createMutation = useCreatePromptGroupMutation();

  // Color is picker-driven, not a validated form field — local state.
  const [color, setColor] = useState("");

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<PromptGroupFormValues>({
    resolver: zodResolver(promptGroupFormSchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    type MutationArgs = Parameters<typeof createMutation.mutateAsync>[0];
    const args: MutationArgs = { name: values.name };
    if (color !== "") args.color = color;

    try {
      const group = await createMutation.mutateAsync(args);
      onCreated?.(group);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError("root.serverError", { message: `Failed to create: ${message}` });
    }
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const handleCancel = useCallback((): void => {
    onClose();
  }, [onClose]);

  const serverError = errors.root?.serverError?.message;

  return (
    <>
      {/*
       * audit-D: identity picker (color) renders on the LEFT of the
       * name field in a horizontal row. Compact ~64-72 px square so
       * the name column flexes to fill remaining width. Reset hangs
       * below the color square inside the same column to keep the
       * picker self-contained.
       */}
      <div
        className={styles.identityRow}
        data-testid="prompt-group-create-dialog-identity-row"
      >
        <div className={styles.identityPicker}>
          <IconColorPicker
            value={{ icon: null, color: color === "" ? null : color }}
            onChange={(next) => setColor(next.color ?? "")}
            ariaLabel="Group color"
            data-testid="prompt-group-create-dialog-color-input"
          />
        </div>
        <div className={styles.identityFields}>
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Input
                label="Name"
                value={field.value}
                onChange={field.onChange}
                placeholder="Group name"
                autoFocus
                className={styles.fullWidthInput}
                data-testid="prompt-group-create-dialog-name-input"
              />
            )}
          />
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-group-create-dialog-error"
          >
            {serverError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-group-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={isSubmitting}
          isDisabled={!isValid}
          onPress={handleSubmitPress}
          data-testid="prompt-group-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
