/**
 * RoleEditor — role detail / edit modal.
 *
 * Props:
 *   - `roleId` — null → dialog closed; string → dialog open for that role.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useRole, useUpdateRoleMutation } from "@entities/role";
import { Dialog, Button, Input, MarkdownField } from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

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
      title="Роль"
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

interface RoleEditorContentProps {
  roleId: string;
  onClose: () => void;
}

function RoleEditorContent({
  roleId,
  onClose,
}: RoleEditorContentProps): ReactElement {
  const query = useRole(roleId);
  const updateMutation = useUpdateRoleMutation();
  const { pushToast } = useToast();

  // Local edit state — initialised from the loaded role.
  const [localName, setLocalName] = useState("");
  const [localColor, setLocalColor] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when role data loads or roleId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalColor(query.data.color ?? "");
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
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="role-editor-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="role-editor-save"
          >
            Сохранить
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
          data-testid="role-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Не удалось загрузить роль: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="role-editor-cancel"
          >
            Закрыть
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
          data-testid="role-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            Роль не найдена.
          </p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="role-editor-cancel"
          >
            Закрыть
          </Button>
        </div>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const role = query.data;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Название не может быть пустым.");
      return;
    }

    // Empty string → clear to null; non-empty → use value as-is.
    const resolvedColor = localColor === "" ? null : localColor;

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

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        pushToast("success", "Роль сохранена");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Не удалось сохранить роль: ${err.message}`);
        setSaveError(`Не удалось сохранить: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    // Reset local state back to role values before closing.
    setLocalName(role.name);
    setLocalColor(role.color ?? "");
    setLocalContent(role.content);
    setSaveError(null);
    onClose();
  };

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Название"
          value={localName}
          onChange={setLocalName}
          placeholder="Название роли"
          className={styles.fullWidthInput}
          data-testid="role-editor-name-input"
        />
      </div>

      {/* Color */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Цвет</p>
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
            aria-label="Цвет роли"
            data-testid="role-editor-color-input"
          />
          {localColor !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setLocalColor("")}
            >
              Сбросить
            </Button>
          )}
        </div>
      </div>

      {/* Content — implicit view ⇄ edit toggle via MarkdownField (ctq-76 #11). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Содержимое</p>
        <MarkdownField
          value={localContent}
          onChange={setLocalContent}
          placeholder="Содержимое роли (Markdown)..."
          ariaLabel="Содержимое"
          data-testid="role-editor-content-textarea"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
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
          data-testid="role-editor-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="role-editor-save"
        >
          Сохранить
        </Button>
      </div>
    </>
  );
}
