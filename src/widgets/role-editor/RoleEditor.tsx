/**
 * RoleEditor — role detail / edit modal.
 *
 * Props:
 *   - `roleId` — null → dialog closed; string → dialog open for that role.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import {
  useRole,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
} from "@entities/role";
import {
  Dialog,
  EditorShell,
  Button,
  IconColorPicker,
  Input,
  MarkdownField,
} from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import { RoleAttachmentsSections } from "./RoleAttachmentsSections";
import styles from "./RoleEditor.module.css";

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

  // Local edit state — initialised from the loaded role.
  const [localName, setLocalName] = useState("");
  const [localColor, setLocalColor] = useState("");
  const [localIcon, setLocalIcon] = useState<string | null>(null);
  const [localContent, setLocalContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when role data loads or roleId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalColor(query.data.color ?? "");
      setLocalIcon((query.data as { icon?: string | null }).icon ?? null);
      setLocalContent(query.data.content);
      setSaveError(null);
    }
  }, [query.data, roleId]);

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

  const role = query.data;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    // Empty string → clear to null; non-empty → use value as-is.
    const resolvedColor = localColor === "" ? null : localColor;
    const storedIcon =
      (role as { icon?: string | null }).icon ?? null;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: role.id };

    if (trimmedName !== role.name) {
      mutationArgs.name = trimmedName;
    }
    // content is always non-null per the Role binding; send empty string when cleared.
    if (localContent !== role.content) {
      mutationArgs.content = localContent;
    }
    // For nullable color: only include when the resolved value differs from stored.
    if (resolvedColor !== role.color) {
      mutationArgs.color = resolvedColor;
    }
    // For nullable icon: same skip-on-equal pattern.
    if (localIcon !== storedIcon) {
      (mutationArgs as { icon?: string | null }).icon = localIcon;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        pushToast("success", "Role saved");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Failed to save role: ${err.message}`);
        setSaveError(`Failed to save: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    // Reset local state back to role values before closing.
    setLocalName(role.name);
    setLocalColor(role.color ?? "");
    setLocalIcon((role as { icon?: string | null }).icon ?? null);
    setLocalContent(role.content);
    setSaveError(null);
    onClose();
  };

  const handleDelete = (): void => {
    const ok = window.confirm(
      `Delete role "${role.name}"? This will also remove the role from any connected agents that have it synced.`,
    );
    if (!ok) return;
    deleteMutation.mutate(role.id, {
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
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Name"
          value={localName}
          onChange={setLocalName}
          placeholder="Role name"
          className={styles.fullWidthInput}
          data-testid="role-editor-name-input"
        />
      </div>

      {/* Identity row (icon + color). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Color</p>
        <IconColorPicker
          value={{ icon: localIcon, color: localColor === "" ? null : localColor }}
          onChange={(next) => {
            setLocalIcon(next.icon);
            setLocalColor(next.color ?? "");
          }}
          ariaLabel="Role color"
          data-testid="role-editor-color-input"
        />
      </div>

      {/* Content — implicit view ⇄ edit toggle via MarkdownField (ctq-76 #11). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Content</p>
        <MarkdownField
          value={localContent}
          onChange={setLocalContent}
          placeholder="Role content (Markdown)…"
          ariaLabel="Content"
          data-testid="role-editor-content-textarea"
        />
      </div>

      {/* Attached prompts / skills / MCP tools (ctq-103, ctq-116). */}
      <RoleAttachmentsSections roleId={role.id} />

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
        {saveError ? (
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
          onPress={handleSave}
          data-testid="role-editor-save"
        >
          Save
        </Button>
      </EditorShell.Footer>
    </>
  );
}
