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

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocationCompat as useLocation, useParamsCompat as useParams } from "@shared/lib";

import {
  boardsKeys,
  useBoard,
  useDeleteBoardMutation,
  useSetBoardPromptsMutation,
  useUpdateBoardMutation,
} from "@entities/board";
import type { Board } from "@entities/board";
import {
  useBoardPromptGroups,
  useSetBoardPromptGroupsMutation,
  useGroupedPromptSelect,
} from "@entities/prompt-group";
import { useRoles } from "@entities/role";
import { useSpacePrompts } from "@entities/space";
import { invoke } from "@shared/api";
import {
  Button,
  Collapsible,
  ConfirmDialog,
  EditorShell,
  IconColorPicker,
  Input,
  SelectTag,
  OriginBadge,
  SaveBar,
  Select,
  SelectItem,
  SettingsCard,
  TextArea,
} from "@shared/ui";
import { useToast } from "@shared/lib";
import { boardPath, routes } from "@app/routes";

import styles from "./BoardSettings.module.css";

// `trimNullable` collapses a blank string to `null` for the nullable
// description field; the appearance picker's `""` color sentinel maps to
// `null` inline at submit time.
const trimNullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

// Form schema. `name` is required (trimmed, non-empty); `description` is
// optional free-text (collapses to null at submit); appearance fields are
// nullable.
const boardSettingsSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  description: z.string(),
  icon: z.string().nullable(),
  color: z.string(),
});

type BoardSettingsFormValues = z.infer<typeof boardSettingsSchema>;

function BoardSettingsScreen({
  children,
}: {
  children: ReactElement;
}): ReactElement {
  return (
    <section className={styles.shell} data-testid="board-settings-shell-root">
      {children}
    </section>
  );
}

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
      <BoardSettingsScreen>
        <EditorShell testId="board-settings-shell" className={styles.shell}>
          <EditorShell.Body
            testId="board-settings-scroll"
            className={styles.shellBody}
          >
            <div className={styles.root} data-testid="board-settings">
              <SettingsCard.StatePanel role="status" message="Loading board…" />
            </div>
          </EditorShell.Body>
        </EditorShell>
      </BoardSettingsScreen>
    );
  }

  if (boardQuery.status === "error" || !boardQuery.data) {
    return (
      <BoardSettingsScreen>
        <EditorShell testId="board-settings-shell" className={styles.shell}>
          <EditorShell.Body
            testId="board-settings-scroll"
            className={styles.shellBody}
          >
            <div className={styles.root} data-testid="board-settings">
              <SettingsCard.StatePanel
                role="alert"
                message={
                  boardQuery.status === "error"
                    ? `Failed to load board: ${boardQuery.error.message}`
                    : "Board not found."
                }
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => setLocation(routes.boards)}
                  >
                    Back to boards
                  </Button>
                }
              />
            </div>
          </EditorShell.Body>
        </EditorShell>
      </BoardSettingsScreen>
    );
  }

  const board = boardQuery.data;

  return (
    <BoardSettingsScreen>
      <EditorShell testId="board-settings-shell" className={styles.shell}>
        <EditorShell.Body
          testId="board-settings-scroll"
          className={styles.shellBody}
        >
          <div className={styles.root} data-testid="board-settings">
            <BoardSettingsForm
              key={board.id}
              boardId={board.id}
              spaceId={board.spaceId}
              initialName={board.name}
              initialDescription={board.description ?? ""}
              initialIcon={board.icon ?? null}
              initialColor={board.color ?? ""}
              initialOwnerRoleId={board.ownerRoleId}
              isDefault={board.isDefault}
            />
          </div>
        </EditorShell.Body>
      </EditorShell>
    </BoardSettingsScreen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface BoardSettingsFormProps {
  boardId: string;
  spaceId: string;
  initialName: string;
  initialDescription: string;
  initialIcon: string | null;
  initialColor: string;
  /** Role that owns this board (`boards.owner_role_id`, ctq-105/106). */
  initialOwnerRoleId: string;
  isDefault: boolean;
}

function BoardSettingsForm({
  boardId,
  spaceId,
  initialName,
  initialDescription,
  initialIcon,
  initialColor,
  initialOwnerRoleId,
  isDefault,
}: BoardSettingsFormProps): ReactElement {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateBoardMutation();
  const deleteMutation = useDeleteBoardMutation();
  // Owner-cat picker source. `excludeSystem: true` drops the
  // coordinator-only `dirizher-system` row (ctq-88 guard) but keeps
  // `maintainer-system` and every user-defined cat.
  const rolesQuery = useRoles({ excludeSystem: true });
  const { pushToast } = useToast();

  // Form-migration: dirty-tracking + partial-payload + save-status are now
  // driven by react-hook-form. audit-#12: `position` is not user-editable
  // (drag-reorder owns ordering); the Space picker is gone too — a board's
  // space is set when the owning role is attached.
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors, isDirty, isValid },
  } = useForm<BoardSettingsFormValues>({
    resolver: zodResolver(boardSettingsSchema),
    defaultValues: {
      name: initialName,
      description: initialDescription,
      icon: initialIcon,
      color: initialColor,
    },
    mode: "onChange",
  });

  // Repopulate when the loaded board changes (the page also remounts via
  // `key`, but this keeps the form aligned on background refetch).
  useEffect(() => {
    reset({
      name: initialName,
      description: initialDescription,
      icon: initialIcon,
      color: initialColor,
    });
    setSavedAt(null);
  }, [reset, initialName, initialDescription, initialIcon, initialColor]);

  // Auto-clear the transient "Saved" hint so it doesn't linger.
  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setTimeout(() => setSavedAt(null), 2200);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const watchedName = watch("name");
  const watchedIcon = watch("icon");
  const watchedColor = watch("color");

  const handleAppearanceChange = useCallback(
    (next: { icon: string | null; color: string | null }) => {
      setValue("icon", next.icon, { shouldDirty: true });
      setValue("color", next.color ?? "", { shouldDirty: true });
    },
    [setValue],
  );

  // Local owner state. Mutations apply optimistically — the React
  // Query cache is the single source of truth, this state mirrors it
  // for the rendered <select> value and rolls back on IPC error.
  const [ownerRoleId, setOwnerRoleId] = useState<string>(initialOwnerRoleId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Local prompt-list state for the Board prompts SelectTag.
  // No `list_board_prompts` IPC exists yet (TODO ctq-117) so the chip
  // rail starts empty and `set_board_prompts` is destructive — the
  // tag-input canonically replaces the attached list each call.
  const [boardPromptIds, setBoardPromptIds] = useState<string[]>([]);

  const spacePromptsQuery = useSpacePrompts(spaceId);
  const setBoardPromptsMutation = useSetBoardPromptsMutation();
  const boardGroupsQuery = useBoardPromptGroups(boardId);
  const setBoardGroupsMutation = useSetBoardPromptGroupsMutation();

  /**
   * Owner-cat reassignment. Optimistically writes the new id into the
   * `["boards", boardId]` cache entry, kicks the IPC, and rolls back
   * on failure. Toasts on both success and error so the user sees the
   * outcome regardless of where focus lands.
   *
   * The IPC contract is `set_board_owner(boardId, roleId)` (ctq-101):
   * the use case rewrites the owner role and returns the authoritative
   * `Board`, which `onSuccess` re-syncs into the cache.
   */
  const setOwnerMutation = useMutation<
    Board,
    Error,
    { boardId: string; roleId: string },
    { previous: Board | undefined; previousLocal: string }
  >({
    mutationFn: async ({ boardId: id, roleId }) => {
      return invoke<Board>("set_board_owner", {
        boardId: id,
        roleId,
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
      pushToast("error", `Failed to update owner role: ${err.message}`);
    },
    onSuccess: (updated) => {
      // Re-sync detail entry with server-authoritative timestamps,
      // and bump the list cache so any board cards rendering owner
      // info pick up the change.
      queryClient.setQueryData(boardsKeys.detail(boardId), updated);
      void queryClient.invalidateQueries({ queryKey: boardsKeys.list() });
      pushToast("success", "Owner agent updated");
    },
  });

  const trimmedName = watchedName.trim();
  const resolvedColor = watchedColor === "" ? null : watchedColor;

  // Partial-payload save: only fields whose normalised value differs from
  // the loaded board are forwarded to `update_board`. `handleSubmit` runs
  // the zod resolver first, so an empty name short-circuits before mutate.
  const onValid = handleSubmit((values) => {
    clearErrors("root.serverError");
    setSavedAt(null);

    const nextName = values.name.trim();
    const nextDescription = trimNullable(values.description);
    const nextColor = values.color === "" ? null : values.color;
    const initialDescriptionValue =
      initialDescription === "" ? null : initialDescription;
    const initialColorValue = initialColor === "" ? null : initialColor;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const args: MutationArgs = { id: boardId };
    if (nextName !== initialName) args.name = nextName;
    if (nextDescription !== initialDescriptionValue) {
      args.description = nextDescription;
    }
    if (values.icon !== initialIcon) args.icon = values.icon;
    if (nextColor !== initialColorValue) args.color = nextColor;

    updateMutation.mutate(args, {
      onSuccess: () => setSavedAt(Date.now()),
      onError: (err) => {
        setError("root.serverError", {
          message: `Failed to save: ${err.message}`,
        });
        pushToast("error", `Failed to save board: ${err.message}`);
      },
    });
  });

  const handleSave = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const serverError = errors.root?.serverError?.message ?? null;

  const handleOwnerChange = useCallback(
    (key: React.Key | null): void => {
      const next = String(key);
      if (next === ownerRoleId) return;
      setOwnerMutation.mutate({ boardId, roleId: next });
    },
    [ownerRoleId, setOwnerMutation, boardId],
  );

  const handleBoardPromptsChange = useCallback(
    (next: string[]): void => {
      setBoardPromptIds(next);
      setBoardPromptsMutation.mutate(
        { boardId, promptIds: next },
        {
          onError: (err) => {
            pushToast(
              "error",
              `Failed to update board prompts: ${err.message}`,
            );
          },
        },
      );
    },
    [boardId, setBoardPromptsMutation, pushToast],
  );

  const attachedBoardGroupIds = useMemo(
    () => boardGroupsQuery.data ?? [],
    [boardGroupsQuery.data],
  );

  const handleBoardGroupsChange = useCallback(
    (next: string[]): void => {
      setBoardGroupsMutation.mutate(
        { id: boardId, groupIds: next },
        {
          onError: (err) => {
            pushToast(
              "error",
              `Failed to update board prompt groups: ${err.message}`,
            );
          },
        },
      );
    },
    [boardId, setBoardGroupsMutation, pushToast],
  );

  const boardPromptSelect = useGroupedPromptSelect({
    attachedPromptIds: boardPromptIds,
    attachedGroupIds: attachedBoardGroupIds,
    onChangePrompts: handleBoardPromptsChange,
    onChangeGroups: handleBoardGroupsChange,
  });

  const handleDelete = useCallback((): void => {
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
  }, [deleteMutation, boardId, pushToast, initialName, setLocation]);

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
          value={{ icon: watchedIcon, color: resolvedColor }}
          onChange={handleAppearanceChange}
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
              ? " This is the default board for its project — it cannot be deleted."
              : ""}
          </p>
        </div>
      </header>

      <Collapsible title="General" testId="board-settings-general-section">
        <div className={styles.fields}>
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Input
                label="Name"
                value={field.value}
                onChange={field.onChange}
                placeholder="Board name"
                data-testid="board-settings-name-input"
              />
            )}
          />

          {/* Owner agent — required (`boards.owner_role_id NOT NULL`).
              Default boards (per-space "Owner") are pinned to the
              maintainer role and cannot be reassigned — block the
              picker to make that contract visible. Per maintainer
              feedback 2026-05-06. */}
          {!isDefault ? (
            <Select
              label="Owner agent"
              selectedKey={ownerRoleId}
              onSelectionChange={handleOwnerChange}
              isDisabled={
                rolesQuery.status !== "success" || setOwnerMutation.isPending
              }
              aria-label="Owner agent"
              data-testid="board-settings-owner-select"
            >
              {rolesQuery.status === "success"
                ? rolesQuery.data.map((r) => (
                    <SelectItem key={r.id} id={r.id}>
                      {r.name}
                    </SelectItem>
                  ))
                : (
                  <SelectItem id={ownerRoleId}>Loading…</SelectItem>
                )}
            </Select>
          ) : null}

          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <TextArea
                label="Description"
                value={field.value}
                onChange={field.onChange}
                placeholder="Optional"
                rows={3}
                data-testid="board-settings-description-input"
              />
            )}
          />
        </div>

        <SaveBar
          error={serverError}
          saved={savedAt !== null}
          isDisabled={!isDirty || !isValid}
          isPending={updateMutation.status === "pending"}
          onSave={handleSave}
          testIdPrefix="board-settings"
        />
      </Collapsible>

      <Collapsible
        title="Board prompts"
        description="Prompts attached at the board level cascade to every task on this board."
        testId="board-settings-prompts-section"
      >
        {spacePromptsQuery.data !== undefined &&
        spacePromptsQuery.data.length > 0 ? (
          <div
            style={{ marginBottom: 12 }}
            data-testid="board-settings-inherited-prompts"
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--color-text-muted)",
                marginBottom: 6,
              }}
            >
              Inherited from space
            </div>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {spacePromptsQuery.data.map((p) => (
                <li
                  key={p.id}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  data-testid={`board-settings-inherited-${p.id}`}
                >
                  <span style={{ fontSize: 12 }}>{p.name}</span>
                  <OriginBadge origin={{ kind: "space", id: spaceId }} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/* Origin scope header — every chip in the SelectTag below
            anchors at the board scope. Surfacing the badge alongside
            the section heading communicates "these cascade to every
            task on this board" before the user picks anything. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-8)",
            marginBottom: 8,
          }}
          data-testid="board-settings-prompts-scope"
        >
          <span
            style={{
              fontSize: "var(--font-size-body-sm)",
              color: "var(--color-text-muted)",
            }}
          >
            Anchored to this board.
          </span>
          <OriginBadge
            origin={{ kind: "board", id: boardId }}
            data-testid="board-settings-prompts-scope-badge"
          />
        </div>
        {/* TODO(ctq-117): seed `values` from `list_board_prompts` once
            the IPC ships. Until then the chip rail starts empty and
            `set_board_prompts` canonically replaces the attached list. */}
        <SelectTag
          label="Board prompts"
          values={boardPromptSelect.values}
          options={boardPromptSelect.options}
          onChange={boardPromptSelect.onChange}
          placeholder="Search prompts or groups…"
          data-testid="board-settings-prompts-select"
        />
      </Collapsible>

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
