/**
 * BoardCreateDialog — modal for creating a new board.
 *
 * Props:
 *   - `isOpen`     — controls dialog visibility.
 *   - `onClose`    — called on Cancel, successful Save, or Esc.
 *   - `onCreated`  — optional callback with the newly-created Board.
 *
 * Space selection: uses `useSpaces()` from `@entities/space`. Defaults
 * to the space flagged `isDefault === true`, falling back to the first
 * space in the list. When no spaces exist yet, shows a "Bootstrap default
 * space" inline prompt (mirrors the existing NewBoardDialog in BoardsList).
 */

import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useCreateBoardMutation } from "@entities/board";
import type { Board } from "@entities/board";
import { useSpaces } from "@entities/space";
import { invoke } from "@shared/api";
import { Dialog, Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";

import styles from "./BoardCreateDialog.module.css";

export interface BoardCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (board: Board) => void;
}

interface SpaceLike {
  id: string;
  name: string;
}

/**
 * `BoardCreateDialog` — modal dialog for creating a new board.
 */
export function BoardCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: BoardCreateDialogProps): ReactElement {
  const { activeSpaceId } = useActiveSpace();

  return (
    <Dialog
      title="Создать доску"
      description="Доски находятся внутри пространства. Введите название и выберите пространство."
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      data-testid="board-create-dialog"
    >
      {() =>
        isOpen ? (
          <BoardCreateDialogContent
            onClose={onClose}
            activeSpaceId={activeSpaceId}
            {...(onCreated !== undefined ? { onCreated } : {})}
          />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface BoardCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (board: Board) => void;
  activeSpaceId: string | null;
}

function BoardCreateDialogContent({
  onClose,
  onCreated,
  activeSpaceId,
}: BoardCreateDialogContentProps): ReactElement {
  const queryClient = useQueryClient();
  const spacesQuery = useSpaces();
  const createBoard = useCreateBoardMutation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * Resolve the effective spaceId for the picker.
   *
   * Priority:
   *   1. Explicitly chosen by the user via the dropdown (`spaceId` state).
   *   2. The globally active space from `ActiveSpaceProvider` (`activeSpaceId`),
   *      when it exists in the loaded spaces list.
   *   3. The space flagged `isDefault === true`.
   *   4. The first space in the list.
   *   5. `null` while spaces are still loading or the list is empty.
   */
  const resolvedSpaceId = (() => {
    if (spaceId !== null) return spaceId;
    if (spacesQuery.status !== "success") return null;
    const spaces = spacesQuery.data;
    if (activeSpaceId !== null && spaces.some((s) => s.id === activeSpaceId)) {
      return activeSpaceId;
    }
    const defaultSpace = spaces.find((s) => s.isDefault);
    return defaultSpace?.id ?? spaces[0]?.id ?? null;
  })();

  const bootstrapSpace = useMutation<SpaceLike, Error, void>({
    mutationFn: async () => {
      const created = await invoke<SpaceLike>("create_space", {
        name: "default",
        prefix: "def",
        description: null,
        isDefault: true,
      });
      return created;
    },
    onSuccess: (created) => {
      setSpaceId(created.id);
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
    onError: (err) => {
      setSubmitError(err.message);
    },
  });

  const noSpacesYet =
    spacesQuery.status === "success" && spacesQuery.data.length === 0;

  const canSubmit = name.trim().length > 0 && resolvedSpaceId !== null;

  const handleSubmit = (): void => {
    setSubmitError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmitError("Название не может быть пустым.");
      return;
    }
    if (!resolvedSpaceId) {
      setSubmitError("Выберите или создайте пространство.");
      return;
    }
    const trimmedDescription = description.trim();
    createBoard.mutate(
      {
        name: trimmedName,
        spaceId: resolvedSpaceId,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      },
      {
        onSuccess: (board) => {
          onCreated?.(board);
          onClose();
        },
        onError: (err) => {
          setSubmitError(`Не удалось создать: ${err.message}`);
        },
      },
    );
  };

  const handleCancel = (): void => {
    onClose();
  };

  return (
    <div className={styles.body}>
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Название"
          value={name}
          onChange={setName}
          placeholder="Например: Дорожная карта"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="board-create-dialog-name-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <label className={styles.selectField}>
          <span className={styles.selectLabel}>Описание</span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Необязательно"
            rows={3}
            data-testid="board-create-dialog-description-input"
          />
        </label>
      </div>

      {/* Space picker */}
      {noSpacesYet && resolvedSpaceId === null ? (
        <div className={cn(styles.section, styles.bootstrap)}>
          <p className={styles.bootstrapHint}>
            Пространств ещё нет. Создайте пространство по умолчанию, чтобы продолжить.
          </p>
          <Button
            variant="secondary"
            size="sm"
            isPending={bootstrapSpace.isPending}
            onPress={() => bootstrapSpace.mutate()}
            data-testid="board-create-dialog-bootstrap-space"
          >
            Создать пространство по умолчанию
          </Button>
        </div>
      ) : (
        <div className={styles.section}>
          <label className={styles.selectField}>
            <span className={styles.selectLabel}>Пространство</span>
            <select
              className={styles.select}
              value={resolvedSpaceId ?? ""}
              onChange={(e) => setSpaceId(e.target.value)}
              data-testid="board-create-dialog-space-select"
            >
              {spacesQuery.status === "success" && spacesQuery.data.length > 0
                ? spacesQuery.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                : <option value="">Загрузка...</option>}
            </select>
          </label>
        </div>
      )}

      {/* Footer */}
      <div className={styles.footer}>
        {submitError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="board-create-dialog-error"
          >
            {submitError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="board-create-dialog-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createBoard.isPending}
          isDisabled={!canSubmit}
          onPress={handleSubmit}
          data-testid="board-create-dialog-save"
        >
          Создать
        </Button>
      </div>
    </div>
  );
}
