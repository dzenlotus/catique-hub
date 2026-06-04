/**
 * TagCreateDialog — modal for creating a new tag.
 *
 * Props:
 *   - `isOpen`    — controls dialog visibility.
 *   - `onClose`   — called on Cancel, successful Save, or Esc.
 *   - `onCreated` — optional callback with the newly-created Tag.
 *
 * Fields: name (required), color (optional with reset).
 */

import { useCallback, useState, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useCreateTagMutation } from "@entities/tag";
import type { Tag } from "@entities/tag";
import { Dialog, Button, IconColorPicker, Input } from "@shared/ui";

import styles from "./TagCreateDialog.module.css";

// react-hook-form schema — name required; color is picker-driven (not a
// form field) and stays as local state, matching the etalon pattern of
// keeping IconColorPicker outside the validated form values.
const tagFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
});

type TagFormValues = z.infer<typeof tagFormSchema>;

export interface TagCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (tag: Tag) => void;
}

/**
 * `TagCreateDialog` — modal dialog for creating a new tag.
 */
export function TagCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: TagCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Create tag"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="tag-create-dialog"
    >
      {() => (
        <TagCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface TagCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (tag: Tag) => void;
}

function TagCreateDialogContent({
  onClose,
  onCreated,
}: TagCreateDialogContentProps): ReactElement {
  const createMutation = useCreateTagMutation();

  // Color is picker-driven, not a validated form field — kept as local
  // state outside react-hook-form (etalon: SpaceCreateDialog icon/color).
  const [color, setColor] = useState("");

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<TagFormValues>({
    resolver: zodResolver(tagFormSchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    type MutationArgs = Parameters<typeof createMutation.mutateAsync>[0];
    const args: MutationArgs = { name: values.name };
    if (color !== "") args.color = color;

    try {
      const tag = await createMutation.mutateAsync(args);
      onCreated?.(tag);
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
      {/* Name */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <Input
              label="Name"
              value={field.value}
              onChange={field.onChange}
              placeholder="Tag name"
              autoFocus
              className={styles.fullWidthInput}
              data-testid="tag-create-dialog-name-input"
            />
          )}
        />
      </div>

      {/* Color (canonical IconColorPicker — color-only mode). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Color</p>
        <IconColorPicker
          value={{ icon: null, color: color === "" ? null : color }}
          onChange={(next) => setColor(next.color ?? "")}
          ariaLabel="Tag color"
          data-testid="tag-create-dialog-color-input"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="tag-create-dialog-error"
          >
            {serverError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="tag-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={isSubmitting}
          isDisabled={!isValid}
          onPress={handleSubmitPress}
          data-testid="tag-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
