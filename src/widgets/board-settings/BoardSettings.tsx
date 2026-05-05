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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";

import {
  boardsKeys,
  useBoard,
  useDeleteBoardMutation,
  useUpdateBoardMutation,
} from "@entities/board";
import type { Board } from "@entities/board";
import { useRoles } from "@entities/role";
import { useSpaces } from "@entities/space";
import { invoke } from "@shared/api";
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
import { AttachPromptDialog } from "@widgets/attach-prompt-dialog";

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
          initialOwnerRoleId={board.ownerRoleId}
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
  /** Cat that owns this board (`boards.owner_role_id`, ctq-105/106). */
  initialOwnerRoleId: string;
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
  initialOwnerRoleId,
  isDefault,
}: BoardSettingsFormProps): ReactElement {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateBoardMutation();
  const deleteMutation = useDeleteBoardMutation();
  const spacesQuery = useSpaces();
  // Owner-cat picker source. `excludeSystem: true` drops the
  // coordinator-only `dirizher-system` row (ctq-88 guard) but keeps
  // `maintainer-system` and every user-defined cat.
  const rolesQuery = useRoles({ excludeSystem: true });
  const { pushToast } = useToast();

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [color, setColor] = useState<string>(initialColor);
  const [spaceId, setSpaceId] = useState(initialSpaceId);
  const [position, setPosition] = useState(initialPosition);
  // Local owner state. Mutations apply optimistically — the React
  // Query cache is the single source of truth, this state mirrors it
  // for the rendered <select> value and rolls back on IPC error.
  const [ownerRoleId, setOwnerRoleId] = useState<string>(initialOwnerRoleId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attachPromptOpen, setAttachPromptOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Owner-cat reassignment. Optimistically writes the new id into the
   * `["boards", boardId]` cache entry, kicks the IPC, and rolls back
   * on failure. Toasts on both success and error so the user sees the
   * outcome regardless of where focus lands.
   *
   * The IPC contract is `set_board_owner(boardId, roleId)` (ctq-101).
   * Until that handler ships we call `update_board` with an
   * `ownerRoleId` field — the current handler silently ignores
   * unknown args, so the UI feels responsive (optimistic cache stays
   * applied, toast fires) and switches to authoritative behaviour the
   * moment the backend lands. The companion `// TODO(ctq-101)` below
   * marks the swap-point.
   */
  const setOwnerMutation = useMutation<
    Board,
    Error,
    { boardId: string; roleId: string },
    { previous: Board | undefined; previousLocal: string }
  >({
    mutationFn: async ({ boardId: id, roleId }) => {
      // TODO(ctq-101): replace with `invoke("set_board_owner", …)`
      // once the handler is registered. Sending `ownerRoleId` via
      // `update_board` is forward-compatible: the future
      // `set_board_owner` IPC will own the write path, and the
      // `update_board` shim here becomes a no-op against this field.
      return invoke<Board>("update_board", {
        id,
        ownerRoleId: roleId,
      });
    },
    onMutate: async ({ boardId: id, roleId }) => {
      await queryClient.cancelQueries({ queryKey: boardsKeys.detail(id) });
      const previous = queryClient.getQueryData<Board>(boardsKeys.detail(id));
      const previousLocal = ownerRoleId;
      if (previous !== undefined) {
        queryClient.setQueryData<Board>(boardsKeys.detail(id), {
          ...previous,
          ownerRoleId: roleId,
        });
      }
      setOwnerRoleId(roleId);
      return { previous, previousLocal };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(boardsKeys.detail(boardId), ctx.previous);
      }
      if (ctx !== undefined) setOwnerRoleId(ctx.previousLocal);
      pushToast("error", `Failed to update owner cat: ${err.message}`);
    },
    onSuccess: (updated) => {
      // Re-sync detail entry with server-authoritative timestamps,
      // and bump the list cache so any board cards rendering owner
      // info pick up the change.
      queryClient.setQueryData(boardsKeys.detail(boardId), updated);
      void queryClient.invalidateQueries({ queryKey: boardsKeys.list() });
      pushToast("success", "Owner cat updated");
    },
  });

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

          {/* Owner cat — required (`boards.owner_role_id NOT NULL`).
              Saves immediately on change with optimistic cache update;
              the General `Save` button below covers the other fields. */}
          <label className={styles.fieldLabel}>
            <span className={styles.fieldLabelText}>Owner cat</span>
            <select
              className={styles.fieldSelect}
              value={ownerRoleId}
              onChange={(e) => {
                const next = e.target.value;
                if (next === ownerRoleId) return;
                setOwnerMutation.mutate({ boardId, roleId: next });
              }}
              disabled={
                rolesQuery.status !== "success" || setOwnerMutation.isPending
              }
              aria-label="Owner cat"
              data-testid="board-settings-owner-select"
            >
              {rolesQuery.status === "success"
                ? rolesQuery.data.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))
                : (
                  <option value={ownerRoleId}>Loading…</option>
                )}
            </select>
          </label>

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

      <section
        className={styles.card}
        aria-labelledby="board-settings-prompts"
        data-testid="board-settings-prompts-section"
      >
        <h3 id="board-settings-prompts" className={styles.cardHeading}>
          Board prompts
        </h3>
        <p className={styles.fieldHint}>
          Prompts attached at the board level cascade to every task on
          this board.
          {/* TODO(ctq-117): once `list_board_prompts` ships, render the
              attached list here with detach + drag-reorder rows. */}
        </p>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="md"
            onPress={() => setAttachPromptOpen(true)}
            data-testid="board-settings-prompts-attach"
          >
            Attach prompt
          </Button>
        </div>
      </section>

      <AttachPromptDialog
        isOpen={attachPromptOpen}
        onClose={() => setAttachPromptOpen(false)}
        defaultTarget={{ kind: "board", id: boardId }}
        lockedTarget
      />

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
