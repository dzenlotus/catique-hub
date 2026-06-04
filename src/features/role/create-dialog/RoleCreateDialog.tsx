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

import { useCallback, useState, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useCreateRoleMutation } from "@entities/role";
import type { Role } from "@entities/role";
import { Dialog, Button, IconColorPicker, Input } from "@shared/ui";

import styles from "./RoleCreateDialog.module.css";

// react-hook-form schema — name required; content optional (sent only
// when non-empty; the IPC client defaults the Rust-required field to "").
// Icon/color are picker-driven local state, not validated form values.
const roleFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  content: z.string().optional(),
});

type RoleFormValues = z.infer<typeof roleFormSchema>;

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

  // Icon/color are picker-driven local state, not validated form fields.
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: { name: "", content: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    type MutationArgs = Parameters<typeof createMutation.mutateAsync>[0];
    const args: MutationArgs = { name: values.name };
    // content defaults to "" on Rust side when omitted; send only when non-empty.
    const content = values.content ?? "";
    if (content !== "") args.content = content;
    if (color !== "") args.color = color;
    if (icon !== null) args.icon = icon;

    try {
      const role = await createMutation.mutateAsync(args);
      onCreated?.(role);
      onClose();
    } catch (err) {
      const detail =
        err instanceof Error && err.message ? err.message : String(err);
      setError("root.serverError", { message: `Failed to create: ${detail}` });
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
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Input
                label="Name"
                value={field.value}
                onChange={field.onChange}
                placeholder="Role name"
                autoFocus
                className={styles.fullWidthInput}
                data-testid="role-create-dialog-name-input"
              />
            )}
          />
        </div>
      </div>

      {/* Content */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Content</p>
        <Controller
          control={control}
          name="content"
          render={({ field }) => (
            <textarea
              className={styles.contentTextarea}
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
              placeholder="Role content (Markdown)…"
              data-testid="role-create-dialog-content-textarea"
              aria-label="Content"
            />
          )}
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="role-create-dialog-error"
          >
            {serverError}
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
          isPending={isSubmitting}
          isDisabled={!isValid}
          onPress={handleSubmitPress}
          data-testid="role-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
