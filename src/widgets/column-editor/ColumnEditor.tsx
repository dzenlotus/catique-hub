/**
 * ColumnEditor — modal for renaming a kanban column, setting its role,
 * and adjusting its position.
 *
 * Props:
 *   - `columnId` — null → dialog closed; string → dialog open for that column.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useColumn, useUpdateColumnMutation } from "@entities/column";
import type { UpdateColumnVars } from "@entities/column";
import { useRoles } from "@entities/role";
import { Dialog, Button, Input, Listbox, ListboxItem } from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./ColumnEditor.module.css";

export interface ColumnEditorProps {
  /** null = closed, string = open for this column id */
  columnId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `ColumnEditor` — modal for viewing and editing a column's name, role,
 * and position.
 *
 * Delegates open/close tracking to `columnId` — when null the `<Dialog>`
 * `isOpen` prop is false, so RAC handles exit animations and focus restoration.
 */
export function ColumnEditor({ columnId, onClose }: ColumnEditorProps): ReactElement {
  const isOpen = columnId !== null;

  return (
    <Dialog
      title="Настройки колонки"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="column-editor"
    >
      {() =>
        columnId !== null ? (
          <ColumnEditorContent columnId={columnId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ColumnEditorContentProps {
  columnId: string;
  onClose: () => void;
}

/** Sentinel key used in the Listbox to represent "no role". */
const NO_ROLE_KEY = "__none__";

function ColumnEditorContent({
  columnId,
  onClose,
}: ColumnEditorContentProps): ReactElement {
  const query = useColumn(columnId);
  const rolesQuery = useRoles();
  const updateMutation = useUpdateColumnMutation();
  const { pushToast } = useToast();

  // Local edit state — initialised from the loaded column.
  const [localName, setLocalName] = useState("");
  // "__none__" = no role selected, otherwise a role id string
  const [localRoleKey, setLocalRoleKey] = useState<string>(NO_ROLE_KEY);
  const [localPosition, setLocalPosition] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when column data loads or columnId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalRoleKey(query.data.roleId ?? NO_ROLE_KEY);
      setLocalPosition(String(query.data.position));
      setSaveError(null);
    }
  }, [query.data, columnId]);

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
            data-testid="column-editor-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="column-editor-save"
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
          data-testid="column-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Не удалось загрузить колонку: {query.error.message}
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
            data-testid="column-editor-cancel"
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
          data-testid="column-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            Колонка не найдена.
          </p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="column-editor-cancel"
          >
            Закрыть
          </Button>
        </div>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const column = query.data;
  const roles = rolesQuery.data ?? [];

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Название не может быть пустым.");
      return;
    }

    // Parse optional numeric position — empty string = skip.
    const parsedPosition =
      localPosition.trim() === "" ? undefined : Number(localPosition);
    if (parsedPosition !== undefined && !Number.isFinite(parsedPosition)) {
      setSaveError("Позиция должна быть числом.");
      return;
    }

    // Resolve the role selection: NO_ROLE_KEY → null (clear), id → string.
    const selectedRoleId: string | null =
      localRoleKey === NO_ROLE_KEY ? null : localRoleKey;

    const mutationArgs: UpdateColumnVars = {
      id: column.id,
      boardId: column.boardId,
    };

    if (trimmedName !== column.name) {
      mutationArgs.name = trimmedName;
    }

    // roleId: skip if unchanged, pass null to clear, pass string to set.
    const currentRoleId = column.roleId ?? null;
    if (selectedRoleId !== currentRoleId) {
      mutationArgs.roleId = selectedRoleId;
    }

    if (parsedPosition !== undefined && parsedPosition !== Number(column.position)) {
      mutationArgs.position = parsedPosition;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        pushToast("success", "Колонка сохранена");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Не удалось сохранить колонку: ${err.message}`);
        setSaveError(`Не удалось сохранить: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    // Reset local state back to column values before closing.
    setLocalName(column.name);
    setLocalRoleKey(column.roleId ?? NO_ROLE_KEY);
    setLocalPosition(String(column.position));
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
          placeholder="Название колонки"
          className={styles.fullWidthInput}
          data-testid="column-editor-name-input"
        />
      </div>

      {/* Role */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Роль</p>
        {rolesQuery.status === "pending" ? (
          <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
        ) : rolesQuery.status === "error" ? (
          <p className={styles.roleError}>
            Не удалось загрузить роли: {rolesQuery.error.message}
          </p>
        ) : (
          <Listbox
            aria-label="Роль"
            selectionMode="single"
            selectedKeys={new Set([localRoleKey])}
            onSelectionChange={(keys) => {
              const selected = [...keys][0];
              if (typeof selected === "string") {
                setLocalRoleKey(selected);
              }
            }}
            data-testid="column-editor-role-select"
          >
            <ListboxItem key={NO_ROLE_KEY} id={NO_ROLE_KEY}>
              (нет роли)
            </ListboxItem>
            {roles.map((role) => (
              <ListboxItem key={role.id} id={role.id}>
                {role.name}
              </ListboxItem>
            ))}
          </Listbox>
        )}
      </div>

      {/* Position */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Позиция</p>
        <input
          type="number"
          className={styles.numberInput}
          value={localPosition}
          onChange={(e) => setLocalPosition(e.target.value)}
          placeholder="Необязательно"
          aria-label="Позиция"
          data-testid="column-editor-position-input"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="column-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="column-editor-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="column-editor-save"
        >
          Сохранить
        </Button>
      </div>
    </>
  );
}
