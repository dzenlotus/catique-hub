/**
 * BoardSettings — per-board settings page.
 *
 * Round-19e: replaces the BoardEditor modal that the kanban-board's
 * "Board options" cog used to open. Same UX rule everywhere — modals
 * for create flows, routed page with `← Back` for edit/settings.
 *
 * Surface:
 *   - Header: IconColorPicker (left of title) + name preview.
 *   - General card: name, description, space picker, position.
 *   - Danger zone: Delete board (hidden when board.isDefault).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useLocation, useParams } from "wouter";

import {
  useBoard,
  useDeleteBoardMutation,
  useUpdateBoardMutation,
} from "@entities/board";
import { useSpaces } from "@entities/space";
import {
  Button,
  ConfirmDialog,
  IconColorPicker,
  Input,
  Listbox,
  ListboxItem,
  Scrollable,
} from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";
import { boardPath, routes } from "@app/routes";

import styles from "./BoardSettings.module.css";

interface BoardSettingsParams {
  boardId: string;
}

export function BoardSettings(): ReactElement {
  const params = useParams<BoardSettingsParams>();
  const boardId = params.boardId ?? "";
  const [, setLocation] = useLocation();
  const boardQuery = useBoard(boardId);

  if (boardQuery.status === "pending") {
    return (
      <Scrollable
        axis="y"
        className={styles.scrollHost}
        data-testid="board-settings-scroll"
      >
        <div className={styles.root} data-testid="board-settings">
          <div className={styles.statusPanel} role="status">
            <p className={styles.statusMessage}>Loading board…</p>
          </div>
        </div>
      </Scrollable>
    );
  }

  if (boardQuery.status === "error" || !boardQuery.data) {
    return (
      <Scrollable
        axis="y"
        className={styles.scrollHost}
        data-testid="board-settings-scroll"
      >
        <div className={styles.root} data-testid="board-settings">
          <div className={styles.statusPanel} role="alert">
            <p className={styles.statusMessage}>
              {boardQuery.status === "error"
                ? `Failed to load board: ${boardQuery.error.message}`
                : "Board not found."}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => setLocation(routes.boards)}
            >
              Back to boards
            </Button>
          </div>
        </div>
      </Scrollable>
    );
  }

  const board = boardQuery.data;

  return (
    <Scrollable
      axis="y"
      className={styles.scrollHost}
      data-testid="board-settings-scroll"
    >
      <div className={styles.root} data-testid="board-settings">
        <BoardSettingsForm
          key={board.id}
          boardId={board.id}
          initialName={board.name}
          initialDescription={board.description ?? ""}
          initialIcon={board.icon ?? null}
          initialColor={board.color ?? ""}
          initialSpaceId={board.spaceId}
          initialPosition={String(board.position)}
          isDefault={board.isDefault}
        />
      </div>
    </Scrollable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface BoardSettingsFormProps {
  boardId: string;
  initialName: string;
  initialDescription: string;
  initialIcon: string | null;
  initialColor: string;
  initialSpaceId: string;
  initialPosition: string;
  isDefault: boolean;
}

function BoardSettingsForm({
  boardId,
  initialName,
  initialDescription,
  initialIcon,
  initialColor,
  initialSpaceId,
  initialPosition,
  isDefault,
}: BoardSettingsFormProps): ReactElement {
  const [, setLocation] = useLocation();
  const updateMutation = useUpdateBoardMutation();
  const deleteMutation = useDeleteBoardMutation();
  const spacesQuery = useSpaces();
  const { pushToast } = useToast();

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [color, setColor] = useState<string>(initialColor);
  const [spaceId, setSpaceId] = useState(initialSpaceId);
  const [position, setPosition] = useState(initialPosition);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset savedAt after a few seconds so the indicator doesn't linger.
  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setTimeout(() => setSavedAt(null), 2200);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const resolvedColor = color === "" ? null : color;
  const initialResolvedColor = initialColor === "" ? null : initialColor;
  const parsedPosition =
    position.trim() === "" ? undefined : Number(position);

  const isDirty =
    trimmedName !== initialName.trim() ||
    trimmedDescription !== initialDescription.trim() ||
    icon !== initialIcon ||
    resolvedColor !== initialResolvedColor ||
    spaceId !== initialSpaceId ||
    (parsedPosition !== undefined &&
      parsedPosition !== Number(initialPosition));

  const canSubmit = trimmedName.length > 0 && isDirty;

  const handleSave = (): void => {
    setError(null);
    setSavedAt(null);
    if (trimmedName.length === 0) {
      setError("Name cannot be empty.");
      return;
    }
    if (parsedPosition !== undefined && !Number.isFinite(parsedPosition)) {
      setError("Position must be a number.");
      return;
    }

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const args: MutationArgs = { id: boardId };
    if (trimmedName !== initialName) args.name = trimmedName;
    if (trimmedDescription !== initialDescription.trim()) {
      args.description =
        trimmedDescription.length > 0 ? trimmedDescription : null;
    }
    if (icon !== initialIcon) args.icon = icon;
    if (resolvedColor !== initialResolvedColor) args.color = resolvedColor;
    if (spaceId !== initialSpaceId) args.spaceId = spaceId;
    if (
      parsedPosition !== undefined &&
      parsedPosition !== Number(initialPosition)
    ) {
      args.position = parsedPosition;
    }

    updateMutation.mutate(args, {
      onSuccess: () => setSavedAt(Date.now()),
      onError: (err) => {
        setError(`Failed to save: ${err.message}`);
        pushToast("error", `Failed to save board: ${err.message}`);
      },
    });
  };

  const handleDelete = (): void => {
    deleteMutation.mutate(boardId, {
      onSuccess: () => {
        setConfirmOpen(false);
        pushToast("success", `Board "${initialName}" deleted`);
        // Drop back to the home shell — boards listing or the next
        // board in the same space.
        setLocation(routes.boards);
      },
      onError: (err) => {
        pushToast("error", `Failed to delete board: ${err.message}`);
        setConfirmOpen(false);
      },
    });
  };

  const spaces = spacesQuery.data ?? [];

  return (
    <>
      <div className={styles.backRow}>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setLocation(boardPath(boardId))}
          data-testid="board-settings-back"
        >
          ← Back
        </Button>
      </div>

      <header
        className={styles.pageHeader}
        aria-labelledby="board-settings-heading"
      >
        <IconColorPicker
          value={{ icon, color: resolvedColor }}
          onChange={(next) => {
            setIcon(next.icon);
            setColor(next.color ?? "");
          }}
          ariaLabel="Board icon and color"
          data-testid="board-settings-appearance-picker"
        />
        <div className={styles.pageHeaderText}>
          <h2 id="board-settings-heading" className={styles.pageTitle}>
            {trimmedName.length > 0 ? trimmedName : initialName}
          </h2>
          <p className={styles.pageDescription}>
            Board settings.
            {isDefault
              ? " This is the default board for its space — it cannot be deleted."
              : ""}
          </p>
        </div>
      </header>

      <section className={styles.card} aria-labelledby="board-settings-form">
        <h3 id="board-settings-form" className={styles.cardHeading}>
          General
        </h3>
        <div className={styles.fields}>
          <Input
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Board name"
            data-testid="board-settings-name-input"
          />

          <label className={styles.fieldLabel}>
            <span className={styles.fieldLabelText}>Description</span>
            <textarea
              className={styles.fieldTextarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
              aria-label="Description"
              data-testid="board-settings-description-input"
            />
          </label>

          <div className={styles.fieldLabel}>
            <span className={styles.fieldLabelText}>Space</span>
            {spacesQuery.status === "pending" ? (
              <p className={styles.fieldHint}>Loading…</p>
            ) : spaces.length === 0 ? (
              <p className={styles.fieldHint}>No spaces available.</p>
            ) : (
              <Listbox
                aria-label="Space"
                selectionMode="single"
                selectedKeys={new Set([spaceId])}
                onSelectionChange={(keys) => {
                  const selected = [...keys][0];
                  if (typeof selected === "string") setSpaceId(selected);
                }}
                data-testid="board-settings-space-select"
              >
                {spaces.map((s) => (
                  <ListboxItem key={s.id} id={s.id}>
                    {s.name}
                  </ListboxItem>
                ))}
              </Listbox>
            )}
          </div>

          <Input
            label="Position"
            value={position}
            onChange={setPosition}
            placeholder="Optional"
            data-testid="board-settings-position-input"
          />
        </div>

        <div className={styles.actions}>
          {error !== null ? (
            <p
              className={styles.error}
              role="alert"
              data-testid="board-settings-error"
            >
              {error}
            </p>
          ) : null}
          {error === null && savedAt !== null ? (
            <p
              className={styles.savedHint}
              role="status"
              data-testid="board-settings-saved"
            >
              Saved
            </p>
          ) : null}
          <Button
            variant="primary"
            size="md"
            isPending={updateMutation.status === "pending"}
            isDisabled={!canSubmit}
            onPress={handleSave}
            data-testid="board-settings-save"
          >
            Save
          </Button>
        </div>
      </section>

      {!isDefault ? (
        <section
          className={styles.dangerCard}
          aria-labelledby="board-settings-danger"
        >
          <h3 id="board-settings-danger" className={styles.dangerHeading}>
            Danger zone
          </h3>
          <p className={styles.dangerHint}>
            Deleting a board removes every column it owns and every task
            those columns carry. This cannot be undone.
          </p>
          <div>
            <Button
              variant="secondary"
              size="md"
              onPress={() => setConfirmOpen(true)}
              data-testid="board-settings-delete"
            >
              Delete board
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        isOpen={confirmOpen}
        title={`Delete board "${initialName}"?`}
        description="Every column, task, and prompt-attachment under this board will be removed. This cannot be undone."
        confirmLabel="Delete board"
        destructive
        isPending={deleteMutation.status === "pending"}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        data-testid="board-settings-delete-confirm"
      />
    </>
  );
}
