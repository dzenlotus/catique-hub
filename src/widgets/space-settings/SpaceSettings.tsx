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
 */

import { useEffect, useState, type ReactElement } from "react";
import { useParams, useLocation } from "wouter";

import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { boardPath, routes } from "@app/routes";
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
  IconColorPicker,
  Input,
  Scrollable,
} from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";
import { cn } from "@shared/lib";

import styles from "./SpaceSettings.module.css";

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
      <Scrollable
        axis="y"
        className={styles.scrollHost}
        data-testid="space-settings-scroll"
      >
        <div className={styles.root} data-testid="space-settings">
          <div className={styles.statusPanel} role="status">
            <p className={styles.statusMessage}>Loading space…</p>
          </div>
        </div>
      </Scrollable>
    );
  }

  if (spaceQuery.status === "error") {
    return (
      <Scrollable
        axis="y"
        className={styles.scrollHost}
        data-testid="space-settings-scroll"
      >
        <div className={styles.root} data-testid="space-settings">
          <div className={styles.statusPanel} role="alert">
            <p className={styles.statusMessage}>
              Failed to load space: {spaceQuery.error.message}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => setLocation(routes.boards)}
            >
              Back to spaces
            </Button>
          </div>
        </div>
      </Scrollable>
    );
  }

  return (
    <Scrollable
      axis="y"
      className={styles.scrollHost}
      data-testid="space-settings-scroll"
    >
      <div className={styles.root} data-testid="space-settings">
        <SpaceSettingsForm
          key={spaceQuery.data.id}
          spaceId={spaceQuery.data.id}
          initialName={spaceQuery.data.name}
          initialIcon={spaceQuery.data.icon ?? null}
          initialColor={spaceQuery.data.color ?? ""}
          prefix={spaceQuery.data.prefix}
        />
      </div>
    </Scrollable>
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
}

function SpaceSettingsForm({
  spaceId,
  initialName,
  initialIcon,
  initialColor,
  prefix,
}: SpaceSettingsFormProps): ReactElement {
  const updateMutation = useUpdateSpaceMutation();

  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [color, setColor] = useState<string>(initialColor);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const resolvedColor = color === "" ? null : color;
  const initialResolvedColor = initialColor === "" ? null : initialColor;

  const isDirty =
    trimmedName !== initialName.trim() ||
    icon !== initialIcon ||
    resolvedColor !== initialResolvedColor;

  const canSubmit = trimmedName.length > 0 && isDirty;

  const handleSave = (): void => {
    setError(null);
    setSavedAt(null);

    if (trimmedName.length === 0) {
      setError("Name cannot be empty.");
      return;
    }

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const args: MutationArgs = { id: spaceId };
    if (trimmedName !== initialName) args.name = trimmedName;
    if (icon !== initialIcon) args.icon = icon;
    if (resolvedColor !== initialResolvedColor) args.color = resolvedColor;

    updateMutation.mutate(args, {
      onSuccess: () => {
        setSavedAt(Date.now());
      },
      onError: (err) => {
        setError(`Failed to save: ${err.message}`);
      },
    });
  };

  return (
    <>
      <header
        className={styles.pageHeader}
        aria-labelledby="space-settings-heading"
      >
        <IconColorPicker
          value={{ icon, color: resolvedColor }}
          onChange={(next) => {
            setIcon(next.icon);
            setColor(next.color ?? "");
          }}
          ariaLabel="Space icon and color"
          data-testid="space-settings-appearance-picker"
        />
        <div className={styles.pageHeaderText}>
          <h2 id="space-settings-heading" className={styles.pageTitle}>
            {trimmedName.length > 0 ? trimmedName : initialName}
          </h2>
          <p className={styles.pageDescription}>
            Space settings. The prefix is set at creation and cannot be
            changed.
          </p>
        </div>
      </header>

      <section className={styles.card} aria-labelledby="space-settings-form">
        <h3 id="space-settings-form" className={styles.cardHeading}>
          General
        </h3>
      <div className={styles.cardBody}>
        <div className={styles.fields}>
          <Input
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Space name"
            data-testid="space-settings-name-input"
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
        </div>

        <div className={styles.actions}>
          {error !== null ? (
            <p
              className={styles.error}
              role="alert"
              data-testid="space-settings-error"
            >
              {error}
            </p>
          ) : null}
          {error === null && savedAt !== null ? (
            <p
              className={styles.savedHint}
              role="status"
              data-testid="space-settings-saved"
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
            data-testid="space-settings-save"
          >
            Save
          </Button>
        </div>
      </div>
      </section>

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

  const handleAttach = (role: Role): void => {
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
  };

  const handleRemoveConfirmed = (): void => {
    if (pendingRemoval === null) return;
    deleteBoard.mutate(pendingRemoval.boardId, {
      onSuccess: () => {
        pushToast(
          "success",
          `Role detached from ${spaceName}`,
        );
        setPendingRemoval(null);
      },
      onError: (err) => {
        pushToast("error", `Failed to detach role: ${err.message}`);
        setPendingRemoval(null);
      },
    });
  };

  return (
    <>
      <section
        className={styles.card}
        aria-labelledby="space-settings-roles"
        data-testid="space-settings-roles-section"
      >
        <h3 id="space-settings-roles" className={styles.cardHeading}>
          Roles
        </h3>

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
      </section>

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        title={
          pendingRemoval
            ? `Detach role and delete board "${pendingRemoval.boardName}"?`
            : "Detach role?"
        }
        description="The board this role owns in the current space will be removed, along with its tasks and columns. The role itself stays in the global Roles list."
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

  const handleDelete = (): void => {
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
  };

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
