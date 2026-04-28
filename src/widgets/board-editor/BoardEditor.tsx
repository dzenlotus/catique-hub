/**
 * BoardEditor — board detail / edit modal.
 *
 * Props:
 *   - `boardId` — null → dialog closed; string → dialog open for that board.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useBoard, useUpdateBoardMutation } from "@entities/board";
import { useSpaces } from "@entities/space";
import { Dialog, Button, Input, Listbox, ListboxItem } from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./BoardEditor.module.css";

export interface BoardEditorProps {
  /** null = closed, string = open for this board id */
  boardId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `BoardEditor` — modal for viewing and editing a board's name, space,
 * and position.
 *
 * Delegates open/close tracking to `boardId` — when null the `<Dialog>`
 * `isOpen` prop is false, so RAC handles exit animations and focus restoration.
 */
export function BoardEditor({ boardId, onClose }: BoardEditorProps): ReactElement {
  const isOpen = boardId !== null;

  return (
    <Dialog
      title="Редактирование доски"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="board-editor"
    >
      {() =>
        boardId !== null ? (
          <BoardEditorContent boardId={boardId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface BoardEditorContentProps {
  boardId: string;
  onClose: () => void;
}

function BoardEditorContent({
  boardId,
  onClose,
}: BoardEditorContentProps): ReactElement {
  const query = useBoard(boardId);
  const spacesQuery = useSpaces();
  const updateMutation = useUpdateBoardMutation();
  const { pushToast } = useToast();

  // Local edit state — initialised from the loaded board.
  const [localName, setLocalName] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const [localSpaceId, setLocalSpaceId] = useState("");
  const [localPosition, setLocalPosition] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when board data loads or boardId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalDescription(query.data.description ?? "");
      setLocalSpaceId(query.data.spaceId);
      setLocalPosition(String(query.data.position));
      setSaveError(null);
    }
  }, [query.data, boardId]);

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
            data-testid="board-editor-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="board-editor-save"
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
          data-testid="board-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Не удалось загрузить доску: {query.error.message}
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
            data-testid="board-editor-cancel"
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
          data-testid="board-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            Доска не найдена.
          </p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="board-editor-cancel"
          >
            Закрыть
          </Button>
        </div>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const board = query.data;
  const spaces = spacesQuery.data ?? [];

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Название не может быть пустым.");
      return;
    }
    if (!localSpaceId) {
      setSaveError("Необходимо выбрать пространство.");
      return;
    }

    // Parse optional numeric position — empty string = skip.
    const parsedPosition =
      localPosition.trim() === "" ? undefined : Number(localPosition);
    if (parsedPosition !== undefined && !Number.isFinite(parsedPosition)) {
      setSaveError("Позиция должна быть числом.");
      return;
    }

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: board.id };

    if (trimmedName !== board.name) {
      mutationArgs.name = trimmedName;
    }
    if (localSpaceId !== board.spaceId) {
      mutationArgs.spaceId = localSpaceId;
    }
    if (parsedPosition !== undefined && parsedPosition !== board.position) {
      mutationArgs.position = parsedPosition;
    }
    const trimmedDescription = localDescription.trim();
    const storedDescription = board.description ?? "";
    if (trimmedDescription !== storedDescription) {
      // Send null to clear, string to set.
      mutationArgs.description = trimmedDescription === "" ? null : trimmedDescription;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        pushToast("success", "Доска сохранена");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Не удалось сохранить доску: ${err.message}`);
        setSaveError(`Не удалось сохранить: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    // Reset local state back to board values before closing.
    setLocalName(board.name);
    setLocalDescription(board.description ?? "");
    setLocalSpaceId(board.spaceId);
    setLocalPosition(String(board.position));
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
          placeholder="Название доски"
          className={styles.fullWidthInput}
          data-testid="board-editor-name-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Описание</p>
        <textarea
          className={styles.textarea}
          value={localDescription}
          onChange={(e) => setLocalDescription(e.target.value)}
          placeholder="Необязательно"
          rows={3}
          aria-label="Описание"
          data-testid="board-editor-description-input"
        />
      </div>

      {/* Space */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Пространство</p>
        {spacesQuery.status === "pending" ? (
          <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
        ) : spacesQuery.status === "error" ? (
          <p className={styles.spaceError}>
            Не удалось загрузить пространства: {spacesQuery.error.message}
          </p>
        ) : (
          <Listbox
            aria-label="Пространство"
            selectionMode="single"
            selectedKeys={new Set([localSpaceId])}
            onSelectionChange={(keys) => {
              const selected = [...keys][0];
              if (typeof selected === "string") {
                setLocalSpaceId(selected);
              }
            }}
            data-testid="board-editor-space-select"
          >
            {spaces.map((space) => (
              <ListboxItem key={space.id} id={space.id}>
                {space.name}
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
          data-testid="board-editor-position-input"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="board-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="board-editor-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="board-editor-save"
        >
          Сохранить
        </Button>
      </div>
    </>
  );
}
