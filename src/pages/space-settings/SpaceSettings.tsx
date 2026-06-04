/**
 * SpaceSettings — per-space settings page.
 *
 * Reachable via `/spaces/:spaceId/settings`. The Sidebar's SpaceRow
 * navigates here whenever the user clicks the space name or selects
 * "Space settings" from the kebab menu.
 *
 * Surface:
 *   - Editable: name, icon, color.
 *   - Read-only: prefix (immutable per Rust `update_space` contract).
 *   - "Save" button fires `useUpdateSpaceMutation` and surfaces success /
 *     error inline.
 *
 * On mount the page sets `activeSpaceId` so the rest of the shell stays
 * aligned with the URL.
 *
 * Audit-#13: the `description` form field was removed. `Space.description`
 * is never rendered anywhere in the space view, so the input was dead.
 * Schema column kept; field can return when a rendering surface needs it.
 *
 * Form-migration: dirty-tracking + partial-payload + save-status are now
 * driven by react-hook-form (`useForm` + `zodResolver`). `formState.isDirty`
 * gates Save; only changed fields are forwarded to `update_space`; the
 * status / Save row stays in `<SaveBar>` (server error via
 * `errors.root.serverError`, the transient "Saved" hint via local state);
 * the General card stays in `<SettingsCard>`. The loading / error guards
 * use `SettingsCard.StatePanel`.
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParamsCompat as useParams, useLocationCompat as useLocation } from "@shared/lib";

import { useActiveSpace } from "@shared/lib";
import { boardPath, routes } from "@app/routes";
import { invoke } from "@shared/api";
import { pickFolder } from "@shared/lib";
import {
  useDeleteSpaceMutation,
  useSpace,
  useUpdateSpaceMutation,
} from "@entities/space";
import {
  useBoards,
  useCreateBoardMutation,
  useDeleteBoardMutation,
} from "@entities/board";
import { useRoles } from "@entities/role";
import type { Role } from "@entities/role";
import {
  Button,
  ConfirmDialog,
  EntityTitle,
  Input,
  SaveBar,
  Scrollable,
  SettingsCard,
} from "@shared/ui";
import { useToast } from "@shared/lib";
import { cn } from "@shared/lib";

import styles from "./SpaceSettings.module.css";

function SpaceSettingsScreen({
  children,
}: {
  children: ReactElement;
}): ReactElement {
  return (
    <section className={styles.shell} data-testid="space-settings-root">
      <Scrollable
        axis="y"
        className={styles.scrollHost}
        data-testid="space-settings-scroll"
      >
        <div className={styles.root} data-testid="space-settings">
          {children}
        </div>
      </Scrollable>
    </section>
  );
}

interface SpaceSettingsParams {
  spaceId: string;
}

export function SpaceSettings(): ReactElement {
  const params = useParams<SpaceSettingsParams>();
  const spaceId = params.spaceId ?? "";
  const [, setLocation] = useLocation();
  const { setActiveSpaceId } = useActiveSpace();

  const spaceQuery = useSpace(spaceId);

  // Keep active space aligned with the URL — mirrors the
  // `onSelectSpace` behaviour from the sidebar so deep-links work.
  useEffect(() => {
    if (spaceId.length > 0) setActiveSpaceId(spaceId);
  }, [spaceId, setActiveSpaceId]);

  if (spaceQuery.status === "pending") {
    return (
      <SpaceSettingsScreen>
        <SettingsCard.StatePanel role="status" message="Loading space…" />
      </SpaceSettingsScreen>
    );
  }

  if (spaceQuery.status === "error") {
    return (
      <SpaceSettingsScreen>
        <SettingsCard.StatePanel
          role="alert"
          message={`Failed to load space: ${spaceQuery.error.message}`}
          action={
            <Button
              variant="secondary"
              size="sm"
              onPress={() => setLocation(routes.boards)}
            >
              Back to spaces
            </Button>
          }
        />
      </SpaceSettingsScreen>
    );
  }

  return (
    <SpaceSettingsScreen>
      <SpaceSettingsForm
        key={spaceQuery.data.id}
        spaceId={spaceQuery.data.id}
        initialName={spaceQuery.data.name}
        initialIcon={spaceQuery.data.icon ?? null}
        initialColor={spaceQuery.data.color ?? ""}
        prefix={spaceQuery.data.prefix}
        initialProjectFolderPath={spaceQuery.data.projectFolderPath ?? ""}
      />
    </SpaceSettingsScreen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form — kept as a separate component so it remounts cleanly when the
// caller swaps spaceId via `key`.
// ─────────────────────────────────────────────────────────────────────────────

interface SpaceSettingsFormProps {
  spaceId: string;
  initialName: string;
  /** Pixel-icon identifier or `null` if unset. */
  initialIcon: string | null;
  /** Hex color or `""` if unset. */
  initialColor: string;
  prefix: string;
  /** Round-21: absolute project folder path or `""` if unset. */
  initialProjectFolderPath: string;
}

// Form schema. `name` is required (trimmed, non-empty); appearance
// fields are nullable; the project folder is an optional free-text path.
// Normalisation happens at submit time when assembling the partial payload.
const spaceSettingsSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  icon: z.string().nullable(),
  color: z.string(),
  projectFolderPath: z.string(),
});

type SpaceSettingsFormValues = z.infer<typeof spaceSettingsSchema>;

function entityToValues(
  props: Pick<
    SpaceSettingsFormProps,
    "initialName" | "initialIcon" | "initialColor" | "initialProjectFolderPath"
  >,
): SpaceSettingsFormValues {
  return {
    name: props.initialName,
    icon: props.initialIcon,
    color: props.initialColor,
    projectFolderPath: props.initialProjectFolderPath,
  };
}

const trimNullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

function SpaceSettingsForm({
  spaceId,
  initialName,
  initialIcon,
  initialColor,
  prefix,
  initialProjectFolderPath,
}: SpaceSettingsFormProps): ReactElement {
  const updateMutation = useUpdateSpaceMutation();
  // Transient "Saved" hint, auto-cleared so it doesn't linger. The form's
  // dirty/valid state and the server error come from react-hook-form.
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    setError,
    clearErrors,
    getValues,
    watch,
    formState: { errors, isDirty, isValid },
  } = useForm<SpaceSettingsFormValues>({
    resolver: zodResolver(spaceSettingsSchema),
    defaultValues: entityToValues({
      initialName,
      initialIcon,
      initialColor,
      initialProjectFolderPath,
    }),
    mode: "onChange",
  });

  // Repopulate when the loaded space changes (the page also remounts via
  // `key`, but this keeps the form aligned on background refetch).
  useEffect(() => {
    reset(
      entityToValues({
        initialName,
        initialIcon,
        initialColor,
        initialProjectFolderPath,
      }),
    );
    setSavedAt(null);
  }, [reset, initialName, initialIcon, initialColor, initialProjectFolderPath]);

  // Auto-clear the "Saved" hint so it doesn't linger.
  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setTimeout(() => setSavedAt(null), 2200);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const watchedIcon = watch("icon");
  const watchedColor = watch("color");
  const watchedName = watch("name");
  const trimmedName = watchedName.trim();
  const resolvedColor = watchedColor === "" ? null : watchedColor;

  const setName = useCallback(
    (next: string) => setValue("name", next, { shouldDirty: true, shouldValidate: true }),
    [setValue],
  );

  const handleAppearanceChange = useCallback(
    (next: { icon: string | null; color: string | null }) => {
      setValue("icon", next.icon, { shouldDirty: true });
      setValue("color", next.color ?? "", { shouldDirty: true });
    },
    [setValue],
  );

  const handleBrowseProjectFolder = useCallback(async (): Promise<void> => {
    const current = trimNullable(getValues("projectFolderPath") ?? "");
    const picked = await pickFolder({
      title: "Select project folder",
      ...(current !== null ? { defaultPath: current } : {}),
    });
    if (picked !== null) {
      setValue("projectFolderPath", picked, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [getValues, setValue]);

  const handleRevealProjectFolder = useCallback((): void => {
    const resolvedProjectFolderPath = trimNullable(
      getValues("projectFolderPath") ?? "",
    );
    if (resolvedProjectFolderPath === null) return;
    // TODO(round-21-backend): expose `reveal_path_in_default_app` (or
    // similar) IPC. The frontend forwards the path; the Rust side opens
    // the folder in Finder / Explorer using whichever Tauri plugin
    // (`opener` / `shell`) the backend chooses to install. Falls back
    // to a no-op if the IPC isn't wired yet — surfacing an error toast
    // would be premature noise during the round-21 ship.
    void invoke("reveal_path_in_default_app", {
      path: resolvedProjectFolderPath,
    }).catch(() => {
      // Silent: backend handler may not be installed yet.
    });
  }, [getValues]);

  // Partial-payload save: only fields whose normalised value differs from
  // the loaded space are forwarded to `update_space`. `handleSubmit` runs
  // the zod resolver first, so an empty name short-circuits before mutate.
  const onValid = handleSubmit((values) => {
    clearErrors("root.serverError");
    setSavedAt(null);

    const nextName = values.name.trim();
    const nextColor = values.color === "" ? null : values.color;
    const nextFolder = trimNullable(values.projectFolderPath);
    const initialFolder =
      initialProjectFolderPath === "" ? null : initialProjectFolderPath;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const args: MutationArgs = { id: spaceId };
    if (nextName !== initialName) args.name = nextName;
    if (values.icon !== initialIcon) args.icon = values.icon;
    if (nextColor !== (initialColor === "" ? null : initialColor)) {
      args.color = nextColor;
    }
    if (nextFolder !== initialFolder) args.projectFolderPath = nextFolder;

    updateMutation.mutate(args, {
      onSuccess: () => setSavedAt(Date.now()),
      onError: (err) =>
        setError("root.serverError", {
          message: `Failed to save: ${err.message}`,
        }),
    });
  });

  const handleSave = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const serverError = errors.root?.serverError?.message ?? null;
  const folderIsEmpty = trimNullable(watch("projectFolderPath")) === null;

  return (
    <>
      <header className={styles.pageHeader}>
        <EntityTitle
          size="lg"
          editable
          name={trimmedName.length > 0 ? trimmedName : initialName}
          onNameChange={setName}
          description="Space settings. The prefix is set at creation and cannot be changed."
          value={{ icon: watchedIcon, color: resolvedColor }}
          onAppearanceChange={handleAppearanceChange}
          pickerAriaLabel="Project icon and color"
          pickerTestId="space-settings-appearance-picker"
          editTestId="space-settings-name-inline"
        />
      </header>

      <SettingsCard heading="General" headingId="space-settings-form">
        <div className={styles.fields}>
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Input
                label="Name"
                value={field.value}
                onChange={field.onChange}
                placeholder="Project name"
                data-testid="space-settings-name-input"
              />
            )}
          />

          <div className={styles.readOnlyRow}>
            <span className={styles.readOnlyLabel}>Prefix</span>
            <span
              className={styles.readOnlyValue}
              data-testid="space-settings-prefix"
            >
              {prefix}
            </span>
          </div>

          {/* Project folder. The Browse button opens the OS-native
           * folder picker (Finder on macOS, Explorer on Windows, GTK /
           * KDE on Linux); the picked path lands in the input below. */}
          <div className={styles.projectFolderRow}>
            <Controller
              control={control}
              name="projectFolderPath"
              render={({ field }) => (
                <Input
                  label="Project folder"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="/Users/you/projects/my-app"
                  description="Optional. Click Browse to pick a folder, or paste a path."
                  className={styles.projectFolderInput}
                  data-testid="space-settings-project-folder-input"
                />
              )}
            />
            <Button
              variant="secondary"
              size="sm"
              onPress={() => void handleBrowseProjectFolder()}
              aria-label="Browse for project folder"
              data-testid="space-settings-project-folder-browse"
            >
              Browse…
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleRevealProjectFolder}
              isDisabled={folderIsEmpty}
              aria-label="Reveal project folder in Finder"
              data-testid="space-settings-project-folder-reveal"
            >
              Reveal in Finder
            </Button>
          </div>
        </div>

        <SaveBar
          error={serverError}
          saved={savedAt !== null}
          isDisabled={!isDirty || !isValid}
          isPending={updateMutation.status === "pending"}
          onSave={handleSave}
          testIdPrefix="space-settings"
        />
      </SettingsCard>

      <RolesSection spaceId={spaceId} spaceName={initialName} />

      <DangerZone spaceId={spaceId} spaceName={initialName} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Roles section — attach roles from the global pool to this space.
// Each attached role corresponds to one board (1 role per space rule).
// ─────────────────────────────────────────────────────────────────────────────

interface RolesSectionProps {
  spaceId: string;
  spaceName: string;
}

function RolesSection({ spaceId, spaceName }: RolesSectionProps): ReactElement {
  const [, setLocation] = useLocation();
  const { pushToast } = useToast();
  const rolesQuery = useRoles();
  const boardsQuery = useBoards();
  const createBoard = useCreateBoardMutation();
  const deleteBoard = useDeleteBoardMutation();
  const [pendingRemoval, setPendingRemoval] = useState<{
    boardId: string;
    boardName: string;
  } | null>(null);

  const allRoles: Role[] = rolesQuery.data ?? [];
  const allBoards = boardsQuery.data ?? [];
  const boardsInSpace = allBoards.filter((b) => b.spaceId === spaceId);

  // Map: roleId → board in this space (1:1).
  const roleToBoard = new Map(
    boardsInSpace.map((b) => [b.ownerRoleId, b]),
  );

  const attachedRoles = allRoles.filter(
    (r) => !r.isSystem && roleToBoard.has(r.id),
  );
  const availableRoles = allRoles.filter(
    (r) => !r.isSystem && !roleToBoard.has(r.id),
  );

  const handleAttach = useCallback(
    (role: Role): void => {
      createBoard.mutate(
        {
          name: role.name,
          spaceId,
          ownerRoleId: role.id,
          ...(role.color !== null ? { color: role.color } : {}),
        },
        {
          onSuccess: (board) => {
            pushToast("success", `${role.name} attached`);
            setLocation(boardPath(board.id));
          },
          onError: (err) => {
            // UNIQUE(space_id, owner_role_id) collision → role already
            // attached (likely cache lag). Show a friendly message
            // instead of a SQL string.
            const raw = err instanceof Error ? err.message : String(err);
            const isDuplicate =
              raw.toLowerCase().includes("unique constraint") ||
              raw.toLowerCase().includes("conflict");
            pushToast(
              "error",
              isDuplicate
                ? `${role.name} is already attached to this space.`
                : `Failed to attach: ${raw}`,
            );
          },
        },
      );
    },
    [createBoard, spaceId, pushToast, setLocation],
  );

  const handleRemoveConfirmed = useCallback((): void => {
    if (pendingRemoval === null) return;
    deleteBoard.mutate(pendingRemoval.boardId, {
      onSuccess: () => {
        pushToast("success", `Role detached from ${spaceName}`);
        setPendingRemoval(null);
      },
      onError: (err) => {
        pushToast("error", `Failed to detach role: ${err.message}`);
        setPendingRemoval(null);
      },
    });
  }, [pendingRemoval, deleteBoard, pushToast, spaceName]);

  return (
    <>
      <SettingsCard
        heading="Agents"
        headingId="space-settings-roles"
        testId="space-settings-roles-section"
      >
        {attachedRoles.length > 0 && (
          <ul className={styles.roleList} role="list">
            {attachedRoles.map((r) => {
              const board = roleToBoard.get(r.id);
              return (
                <li key={r.id} className={styles.roleRow}>
                  <button
                    type="button"
                    className={styles.roleChip}
                    onClick={() => board && setLocation(boardPath(board.id))}
                    data-testid={`space-settings-roles-attached-${r.id}`}
                  >
                    {r.color !== null && (
                      <span
                        className={styles.roleSwatch}
                        style={{ backgroundColor: r.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span className={styles.roleName}>{r.name}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => {
                      if (board) {
                        setPendingRemoval({
                          boardId: board.id,
                          boardName: board.name,
                        });
                      }
                    }}
                    aria-label={`Detach role ${r.name}`}
                    data-testid={`space-settings-roles-detach-${r.id}`}
                  >
                    Detach
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {availableRoles.length > 0 && (
          <ul className={styles.roleList} role="list">
            {availableRoles.map((r) => (
              <li key={r.id} className={styles.roleRow}>
                <button
                  type="button"
                  className={cn(styles.roleChip, styles.roleChipAvailable)}
                  onClick={() => handleAttach(r)}
                  disabled={createBoard.isPending}
                  data-testid={`space-settings-roles-attach-${r.id}`}
                >
                  {r.color !== null && (
                    <span
                      className={styles.roleSwatch}
                      style={{ backgroundColor: r.color }}
                      aria-hidden="true"
                    />
                  )}
                  <span className={styles.roleName}>{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        title={
          pendingRemoval
            ? `Detach role and delete board "${pendingRemoval.boardName}"?`
            : "Detach agent?"
        }
        description="The board this agent owns in the current project will be removed, along with its tasks and columns. The agent itself stays in the global Agents list."
        confirmLabel="Detach"
        destructive
        isPending={deleteBoard.status === "pending"}
        onConfirm={handleRemoveConfirmed}
        onCancel={() => setPendingRemoval(null)}
        data-testid="space-settings-roles-detach-confirm"
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Danger zone — destructive actions for the space.
// ─────────────────────────────────────────────────────────────────────────────

interface DangerZoneProps {
  spaceId: string;
  spaceName: string;
}

function DangerZone({ spaceId, spaceName }: DangerZoneProps): ReactElement {
  const [, setLocation] = useLocation();
  const deleteMutation = useDeleteSpaceMutation();
  const { pushToast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = useCallback((): void => {
    deleteMutation.mutate(spaceId, {
      onSuccess: () => {
        setConfirmOpen(false);
        pushToast("success", `Space "${spaceName}" deleted`);
        // Land on the home shell (boards + sidebar visible) rather
        // than a standalone spaces page — round-19e: the sidebar-less
        // "/spaces" listing was retired.
        setLocation(routes.boards);
      },
      onError: (err) => {
        pushToast("error", `Failed to delete space: ${err.message}`);
        setConfirmOpen(false);
      },
    });
  }, [deleteMutation, spaceId, pushToast, spaceName, setLocation]);

  return (
    <>
      <section
        className={styles.dangerCard}
        aria-labelledby="space-settings-danger"
      >
        <h3 id="space-settings-danger" className={styles.dangerHeading}>
          Danger zone
        </h3>
        <p className={styles.dangerHint}>
          Deleting a space removes every board it owns and every task,
          column, and prompt-attachment those boards carry. This cannot
          be undone.
        </p>
        <div>
          <Button
            variant="secondary"
            size="md"
            onPress={() => setConfirmOpen(true)}
            data-testid="space-settings-delete"
          >
            Delete space
          </Button>
        </div>
      </section>

      <ConfirmDialog
        isOpen={confirmOpen}
        title={`Delete space "${spaceName}"?`}
        description={
          <p>
            Every board inside this space, plus the columns and tasks
            those boards own, will be removed. This cannot be undone.
          </p>
        }
        confirmLabel="Delete space"
        destructive
        isPending={deleteMutation.status === "pending"}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        data-testid="space-settings-delete-confirm"
      />
    </>
  );
}
