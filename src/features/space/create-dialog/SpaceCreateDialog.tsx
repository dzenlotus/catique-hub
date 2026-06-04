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

import { useState, useCallback, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useCreateSpaceMutation, validatePrefix } from "@entities/space";
import type { Space } from "@entities/space";
import { useActiveSpace } from "@shared/lib";
import { Dialog, Button, IconColorPicker, Input } from "@shared/ui";
import { pickFolder } from "@shared/lib";

import styles from "./SpaceCreateDialog.module.css";

// react-hook-form schema (zod v4; zodResolver auto-detects v4). Validation
// that used to live in scattered useState handlers now lives here as the
// single source of truth. `validatePrefix` (the existing domain validator)
// is folded into a superRefine so its exact message surfaces on the field.
const spaceFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  prefix: z
    .string()
    .trim()
    .min(1, "Prefix is required.")
    .superRefine((val, ctx) => {
      const err = validatePrefix(val);
      if (err !== null) ctx.addIssue({ code: "custom", message: err });
    }),
  projectFolderPath: z.string().trim().optional(),
});

type SpaceFormValues = z.infer<typeof spaceFormSchema>;

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
      title="Create project"
      titleLeading={
        <IconColorPicker
          value={{ icon, color: color === "" ? null : color }}
          onChange={(next) => {
            setIcon(next.icon);
            setColor(next.color ?? "");
          }}
          ariaLabel="Project icon and color"
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

  const {
    control,
    handleSubmit,
    setValue,
    setError,
    getValues,
    formState: { errors, isValid, isSubmitting },
  } = useForm<SpaceFormValues>({
    resolver: zodResolver(spaceFormSchema),
    defaultValues: { name: "", prefix: "", projectFolderPath: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    type MutationArgs = Parameters<typeof createMutation.mutateAsync>[0];
    const args: MutationArgs = { name: values.name, prefix: values.prefix };
    if (color !== "") args.color = color;
    if (icon !== null) args.icon = icon;
    const folder = values.projectFolderPath?.trim() ?? "";
    if (folder.length > 0) args.projectFolderPath = folder;

    try {
      const space = await createMutation.mutateAsync(args);
      setActiveSpaceId(space.id);
      onCreated?.(space);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError("root.serverError", {
        message: `Failed to create: ${message}`,
      });
    }
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const handleBrowse = useCallback((): void => {
    const current = getValues("projectFolderPath")?.trim() ?? "";
    void pickFolder({
      title: "Select project folder",
      ...(current.length > 0 ? { defaultPath: current } : {}),
    }).then((picked) => {
      if (picked !== null) {
        setValue("projectFolderPath", picked, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    });
  }, [getValues, setValue]);

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
              placeholder="Project name"
              autoFocus
              className={styles.fullWidthInput}
              data-testid="space-create-dialog-name-input"
            />
          )}
        />
      </div>

      {/* Prefix */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="prefix"
          render={({ field }) => (
            <Input
              label="Prefix"
              value={field.value}
              onChange={field.onChange}
              placeholder="e.g. dev"
              className={styles.fullWidthInput}
              data-testid="space-create-dialog-prefix-input"
            />
          )}
        />
        {errors.prefix?.message ? (
          <p
            className={styles.fieldError}
            role="alert"
            data-testid="space-create-dialog-prefix-error"
          >
            {errors.prefix.message}
          </p>
        ) : null}
      </div>

      {/* Project folder — optional. Browse opens the OS-native folder
       * picker (Finder / Explorer / GTK) and writes the absolute path
       * back into the input. */}
      <div className={styles.section}>
        <div className={styles.projectFolderRow}>
          <Controller
            control={control}
            name="projectFolderPath"
            render={({ field }) => (
              <Input
                label="Project folder"
                value={field.value ?? ""}
                onChange={field.onChange}
                placeholder="/Users/you/projects/my-app"
                description="Optional. Click Browse to pick a folder, or paste a path."
                className={styles.projectFolderInput}
                data-testid="space-create-dialog-project-folder-input"
              />
            )}
          />
          <Button
            variant="secondary"
            size="sm"
            onPress={handleBrowse}
            aria-label="Browse for project folder"
            data-testid="space-create-dialog-project-folder-browse"
          >
            Browse…
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="space-create-dialog-error"
          >
            {serverError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={onClose}
          data-testid="space-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={isSubmitting}
          isDisabled={!isValid}
          onPress={handleSubmitPress}
          data-testid="space-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
