/**
 * RoleEditor — role detail / edit modal.
 *
 * Props:
 *   - `roleId` — null → dialog closed; string → dialog open for that role.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, type ReactElement } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  useRole,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
} from "@entities/role";
import type { Role } from "@entities/role";
import {
  Dialog,
  EditorShell,
  Button,
  EntityTitle,
  MarkdownField,
} from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@shared/lib";
import { HistoryViewerButton } from "@features/version-history";

import { RoleAttachmentsSections } from "./RoleAttachmentsSections";
import { RoleMemorySection } from "./RoleMemorySection";
import { RoleSpacesSection } from "./RoleSpacesSection";
import styles from "./RoleEditor.module.css";

// Name is required (trimmed); content is always-present markdown (empty
// string is valid — sent as "" when cleared). Icon/color are nullable
// appearance fields driven by the EntityTitle picker.
const roleFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  content: z.string(),
  color: z.string(),
  icon: z.string().nullable(),
});

type RoleFormValues = z.infer<typeof roleFormSchema>;

/** Map a loaded role into the editor's form values. */
function roleToFormValues(role: Role): RoleFormValues {
  return {
    name: role.name,
    content: role.content,
    color: role.color ?? "",
    icon: (role as { icon?: string | null }).icon ?? null,
  };
}

export interface RoleEditorProps {
  /** null = closed, string = open for this role id */
  roleId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `RoleEditor` — modal for viewing and editing a role's name, content and color.
 *
 * Delegates open/close tracking to `roleId` — when null the `<Dialog>`
 * `isOpen` prop is false, so RAC handles exit animations and focus restoration.
 */
export function RoleEditor({ roleId, onClose }: RoleEditorProps): ReactElement {
  const isOpen = roleId !== null;

  return (
    <Dialog
      title="Role"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="role-editor"
    >
      {() =>
        roleId !== null ? (
          <RoleEditorContent roleId={roleId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * `RoleEditorPanel` — non-modal version mounted inline on the
 * `/roles/:roleId` route per audit-#9. The page renders this in its
 * content slot so editing happens in the workspace, not over a
 * scrim. Body sections + EditorShell.Footer fragment from
 * `RoleEditorContent` render in a flex-column shell; the page's
 * existing scroll wrapper owns scroll. The footer's
 * `EditorShell.Footer` styled div lands as the last flex child →
 * appears below the form sections.
 */
export function RoleEditorPanel({
  roleId,
  onClose,
}: { roleId: string; onClose: () => void }): ReactElement {
  return (
    <div className={styles.panel} data-testid="role-editor-panel">
      <RoleEditorContent roleId={roleId} onClose={onClose} />
    </div>
  );
}

interface RoleEditorContentProps {
  roleId: string;
  onClose: () => void;
}

export function RoleEditorContent({
  roleId,
  onClose,
}: RoleEditorContentProps): ReactElement {
  const query = useRole(roleId);
  const updateMutation = useUpdateRoleMutation();
  const deleteMutation = useDeleteRoleMutation();
  const { pushToast } = useToast();

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: { name: "", content: "", color: "", icon: null },
    mode: "onChange",
  });

  // The EntityTitle appearance picker drives icon + color together;
  // `useWatch` reads them back for the picker `value` prop without an
  // extra Controller wrapper around the combined name + picker element.
  const watchedColor = useWatch({ control, name: "color" });
  const watchedIcon = useWatch({ control, name: "icon" });

  // Repopulate when role data loads or roleId changes.
  const role = query.data;
  useEffect(() => {
    if (role) {
      reset(roleToFormValues(role));
      clearErrors("root.serverError");
    }
  }, [role, reset, clearErrors]);

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
            data-testid="role-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="role-editor-save"
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
          data-testid="role-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load role: {query.error.message}
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
            data-testid="role-editor-cancel"
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
          data-testid="role-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            Role not found.
          </p>
        </div>
        <EditorShell.Footer className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="role-editor-cancel"
          >
            Close
          </Button>
        </EditorShell.Footer>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  // Narrowed non-null after the !query.data guard above.
  const loadedRole = query.data;

  const onValid = handleSubmit((values) => {
    const trimmedName = values.name.trim();

    // Empty string → clear to null; non-empty → use value as-is.
    const resolvedColor = values.color === "" ? null : values.color;
    const storedIcon =
      (loadedRole as { icon?: string | null }).icon ?? null;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: loadedRole.id };

    if (trimmedName !== loadedRole.name) {
      mutationArgs.name = trimmedName;
    }
    // content is always non-null per the Role binding; send empty string when cleared.
    if (values.content !== loadedRole.content) {
      mutationArgs.content = values.content;
    }
    // For nullable color: only include when the resolved value differs from stored.
    if (resolvedColor !== loadedRole.color) {
      mutationArgs.color = resolvedColor;
    }
    // For nullable icon: same skip-on-equal pattern.
    if (values.icon !== storedIcon) {
      (mutationArgs as { icon?: string | null }).icon = values.icon;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        pushToast("success", "Role saved");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Failed to save role: ${err.message}`);
        setError("root.serverError", {
          message: `Failed to save: ${err.message}`,
        });
      },
    });
  });

  const handleSavePress = (): void => {
    void onValid();
  };

  const handleCancel = (): void => {
    // Reset form back to role values before closing.
    reset(roleToFormValues(loadedRole));
    clearErrors("root.serverError");
    onClose();
  };

  const saveError = errors.root?.serverError?.message;

  const handleDelete = (): void => {
    const ok = window.confirm(
      `Delete role "${loadedRole.name}"? This will also remove the role from any connected agents that have it synced.`,
    );
    if (!ok) return;
    deleteMutation.mutate(loadedRole.id, {
      onSuccess: () => {
        pushToast("success", "Role deleted");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Failed to delete role: ${err.message}`);
      },
    });
  };

  return (
    <>
      {/* Title — inline-editable name + icon-color picker, replaces the
       * old split layout (name input + standalone color picker). */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <EntityTitle
              size="lg"
              editable
              name={field.value}
              onNameChange={field.onChange}
              editPlaceholder="Role name"
              editTestId="role-editor-name-input"
              value={{
                icon: watchedIcon,
                color: watchedColor === "" ? null : watchedColor,
              }}
              onAppearanceChange={(next) => {
                setValue("icon", next.icon, { shouldDirty: true });
                setValue("color", next.color ?? "", { shouldDirty: true });
              }}
              pickerAriaLabel="Role icon and color"
              pickerTestId="role-editor-color-input"
              actions={
                <HistoryViewerButton
                  title="Role content history"
                  kind="role"
                  sourceId={loadedRole.id}
                  currentContent={loadedRole.content}
                  data-testid="role-editor-history"
                />
              }
            />
          )}
        />
      </div>

      {/* Refactor v3 §"Agent detail" — toolkit goes on top so the most
          frequently edited surface is visible without scrolling.
          Instructions land below, with version-history/diff controls
          arriving once D-C ships. */}
      <RoleAttachmentsSections roleId={loadedRole.id} />

      {/* Content — implicit view ⇄ edit toggle via MarkdownField (ctq-76 #11). */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="content"
          render={({ field }) => (
            <MarkdownField
              value={field.value}
              onChange={field.onChange}
              placeholder="Role content (Markdown)…"
              ariaLabel="Content"
              data-testid="role-editor-content-textarea"
            />
          )}
        />
      </div>

      {/* Memory — ctq-137 retrospective curation (MEM-S2). */}
      <RoleMemorySection roleId={loadedRole.id} />

      {/* Working in spaces — boards owned by this agent across the install.
          Phase 4 stub; the "Add to space" CTA lands with Phase 4 polish. */}
      <RoleSpacesSection roleId={loadedRole.id} />

      {/* Footer */}
      <EditorShell.Footer className={styles.footer}>
        <span className={styles.deleteSpacer}>
          <Button
            variant="ghost"
            size="md"
            onPress={handleDelete}
            isPending={deleteMutation.status === "pending"}
            isDisabled={updateMutation.status === "pending"}
            data-testid="role-editor-delete"
          >
            Delete
          </Button>
        </span>
        {saveError !== undefined ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="role-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          isDisabled={deleteMutation.status === "pending"}
          data-testid="role-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          isDisabled={deleteMutation.status === "pending"}
          onPress={handleSavePress}
          data-testid="role-editor-save"
        >
          Save
        </Button>
      </EditorShell.Footer>
    </>
  );
}
