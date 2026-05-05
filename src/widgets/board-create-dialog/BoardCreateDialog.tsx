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

import { boardsKeys } from "@entities/board";
import type { Board } from "@entities/board";
import { useRoles } from "@entities/role";
import { useSpaces } from "@entities/space";
import { invoke } from "@shared/api";
import { Dialog, Button, IconColorPicker, Input } from "@shared/ui";
import { cn } from "@shared/lib";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";

import styles from "./BoardCreateDialog.module.css";

/**
 * Default owner-cat for newly-created boards.
 *
 * Matches the seeded `roles.id = 'maintainer-system'` row from migration
 * `004_cat_as_agent_phase1.sql`. Mirrors the DB-level default on
 * `boards.owner_role_id`, so picking this value in the dialog produces
 * the same effect as omitting it server-side — minus the schema drift
 * risk (`bindings/Board.ts` makes `ownerRoleId` non-null, ctq-105).
 */
const DEFAULT_OWNER_ROLE_ID = "maintainer-system";

/**
 * Args for the local `create_board` mutation. The shared
 * `entities/board` `useCreateBoardMutation` does not yet model
 * `ownerRoleId` — we send it directly here so the schema-required
 * field (migration 004) leaves the dialog. Once the IPC handler in
 * `crates/api/src/handlers/boards.rs` accepts the arg (ctq-101 batch),
 * this mutation can be folded back into the entity.
 */
interface CreateBoardLocalArgs {
  name: string;
  spaceId: string;
  ownerRoleId: string;
  description?: string;
  color?: string;
  icon?: string;
}

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
  // Lifted icon/color so the dialog header picker drives the create
  // payload directly (etalon: PromptCreateDialog). Boards are seeded
  // with a neutral list glyph so the sidebar/kanban-header entry has
  // a baseline icon out of the box; the user can swap or clear it.
  const [icon, setIcon] = useState<string | null>(
    "PixelInterfaceEssentialList",
  );
  const [color, setColor] = useState<string>("");

  return (
    <Dialog
      title="Create board"
      titleLeading={
        <IconColorPicker
          value={{ icon, color: color === "" ? null : color }}
          onChange={(next) => {
            setIcon(next.icon);
            setColor(next.color ?? "");
          }}
          ariaLabel="Board icon and color"
          data-testid="board-create-dialog-appearance-picker"
        />
      }
      description="Boards live inside a space. Enter a name and pick a space."
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setIcon("PixelInterfaceEssentialList");
          setColor("");
          onClose();
        }
      }}
      isDismissable
      data-testid="board-create-dialog"
    >
      {() => (
        <BoardCreateDialogContent
          icon={icon}
          color={color}
          onClose={() => {
            setIcon("PixelInterfaceEssentialList");
            setColor("");
            onClose();
          }}
          activeSpaceId={activeSpaceId}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface BoardCreateDialogContentProps {
  /** Lifted icon state (driven by the dialog header picker). */
  icon: string | null;
  /** Lifted color state (driven by the dialog header picker). */
  color: string;
  onClose: () => void;
  onCreated?: (board: Board) => void;
  activeSpaceId: string | null;
}

function BoardCreateDialogContent({
  icon,
  color,
  onClose,
  onCreated,
  activeSpaceId,
}: BoardCreateDialogContentProps): ReactElement {
  const queryClient = useQueryClient();
  const spacesQuery = useSpaces();
  // Owner-cat picker source. `excludeSystem: true` drops the
  // coordinator-only `dirizher-system` row (ctq-88 guard) while keeping
  // `maintainer-system` and every user-defined cat available.
  const rolesQuery = useRoles({ excludeSystem: true });

  // Local create-board mutation. We bypass `useCreateBoardMutation`
  // from `@entities/board` because that hook's `CreateBoardArgs` does
  // not yet expose `ownerRoleId`. Invalidates the same `["boards"]`
  // root key on success so every mounted `useBoards()` re-fetches.
  const createBoard = useMutation<Board, Error, CreateBoardLocalArgs>({
    mutationFn: async (args) => {
      const payload: Record<string, unknown> = {
        name: args.name,
        spaceId: args.spaceId,
        ownerRoleId: args.ownerRoleId,
      };
      if (args.description !== undefined) payload.description = args.description;
      if (args.color !== undefined) payload.color = args.color;
      if (args.icon !== undefined) payload.icon = args.icon;
      return invoke<Board>("create_board", payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardsKeys.list() });
    },
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  // Default = Maintainer for low-friction creation. The Submit gate
  // below still enforces a non-empty value in case the user clears
  // the picker manually (defensive — UI never offers an empty option).
  const [ownerRoleId, setOwnerRoleId] = useState<string>(
    DEFAULT_OWNER_ROLE_ID,
  );
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

  const canSubmit =
    name.trim().length > 0 &&
    resolvedSpaceId !== null &&
    ownerRoleId.trim().length > 0;

  const handleSubmit = (): void => {
    setSubmitError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmitError("Name cannot be empty.");
      return;
    }
    if (!resolvedSpaceId) {
      setSubmitError("Select or create a space.");
      return;
    }
    if (ownerRoleId.trim().length === 0) {
      setSubmitError("Pick an owner role.");
      return;
    }
    const trimmedDescription = description.trim();
    // `ownerRoleId` is sent verbatim to `create_board`. `bindings/Board.ts`
    // already requires the field non-null (migration 004); the IPC handler
    // accepts it once ctq-101 lands, and meanwhile silently ignores the
    // extra arg while the DB-level DEFAULT keeps `maintainer-system` —
    // matching what the picker pre-selects, so behaviour is consistent.
    createBoard.mutate(
      {
        name: trimmedName,
        spaceId: resolvedSpaceId,
        ownerRoleId,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        ...(color !== "" ? { color } : {}),
        ...(icon !== null ? { icon } : {}),
      },
      {
        onSuccess: (board) => {
          onCreated?.(board);
          onClose();
        },
        onError: (err) => {
          setSubmitError(`Failed to create: ${err.message}`);
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
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Roadmap"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="board-create-dialog-name-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <label className={styles.selectField}>
          <span className={styles.selectLabel}>Description</span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            rows={3}
            data-testid="board-create-dialog-description-input"
          />
        </label>
      </div>

      {/* Owner role picker — required (`boards.owner_role_id NOT NULL`). */}
      <div className={styles.section}>
        <label className={styles.selectField}>
          <span className={styles.selectLabel}>Owner role</span>
          <select
            className={styles.select}
            value={ownerRoleId}
            onChange={(e) => setOwnerRoleId(e.target.value)}
            aria-label="Owner role"
            data-testid="board-create-dialog-owner-select"
          >
            {rolesQuery.status === "success"
              ? rolesQuery.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))
              : (
                <option value={DEFAULT_OWNER_ROLE_ID}>
                  Loading…
                </option>
              )}
          </select>
        </label>
      </div>

      {/* Space picker */}
      {noSpacesYet && resolvedSpaceId === null ? (
        <div className={cn(styles.section, styles.bootstrap)}>
          <p className={styles.bootstrapHint}>
            No spaces yet. Create a default space to continue.
          </p>
          <Button
            variant="secondary"
            size="sm"
            isPending={bootstrapSpace.isPending}
            onPress={() => bootstrapSpace.mutate()}
            data-testid="board-create-dialog-bootstrap-space"
          >
            Create default space
          </Button>
        </div>
      ) : (
        <div className={styles.section}>
          <label className={styles.selectField}>
            <span className={styles.selectLabel}>Space</span>
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
                : <option value="">Loading…</option>}
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
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createBoard.isPending}
          isDisabled={!canSubmit}
          onPress={handleSubmit}
          data-testid="board-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </div>
  );
}
