/**
 * SpaceSettings — per-space settings page.
 *
 * Reachable via `/spaces/:spaceId/settings`. The Sidebar's SpaceRow
 * navigates here whenever the user clicks the space name or selects
 * "Space settings" from the kebab menu.
 *
 * Surface:
 *   - Editable: name, description.
 *   - Read-only: prefix (immutable per Rust `update_space` contract).
 *   - "Save" button fires `useUpdateSpaceMutation` and surfaces success /
 *     error inline.
 *
 * On mount the page sets `activeSpaceId` so the rest of the shell stays
 * aligned with the URL.
 */

import { useEffect, useState, type ReactElement } from "react";
import { useParams, useLocation } from "wouter";

import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { routes } from "@app/routes";
import { useSpace, useUpdateSpaceMutation } from "@entities/space";
import { Button, Input, Scrollable } from "@shared/ui";
import { PixelInterfaceEssentialSettingCog } from "@shared/ui/Icon";

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
      <div className={styles.root} data-testid="space-settings">
        <div className={styles.statusPanel} role="status">
          <p className={styles.statusMessage}>Loading space…</p>
        </div>
      </div>
    );
  }

  if (spaceQuery.status === "error") {
    return (
      <div className={styles.root} data-testid="space-settings">
        <div className={styles.statusPanel} role="alert">
          <p className={styles.statusMessage}>
            Failed to load space: {spaceQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => setLocation(routes.spaces)}
          >
            Back to spaces
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root} data-testid="space-settings">
      <header
        className={styles.pageHeader}
        aria-labelledby="space-settings-heading"
      >
        <PixelInterfaceEssentialSettingCog
          width={20}
          height={20}
          className={styles.pageHeaderIcon}
          aria-hidden={true}
        />
        <div className={styles.pageHeaderText}>
          <h2 id="space-settings-heading" className={styles.pageTitle}>
            {spaceQuery.data.name}
          </h2>
          <p className={styles.pageDescription}>
            Space settings. The prefix is set at creation and cannot be
            changed.
          </p>
        </div>
      </header>

      <SpaceSettingsForm
        key={spaceQuery.data.id}
        spaceId={spaceQuery.data.id}
        initialName={spaceQuery.data.name}
        initialDescription={spaceQuery.data.description ?? ""}
        prefix={spaceQuery.data.prefix}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form — kept as a separate component so it remounts cleanly when the
// caller swaps spaceId via `key`.
// ─────────────────────────────────────────────────────────────────────────────

interface SpaceSettingsFormProps {
  spaceId: string;
  initialName: string;
  initialDescription: string;
  prefix: string;
}

function SpaceSettingsForm({
  spaceId,
  initialName,
  initialDescription,
  prefix,
}: SpaceSettingsFormProps): ReactElement {
  const updateMutation = useUpdateSpaceMutation();

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();

  const isDirty =
    trimmedName !== initialName.trim() ||
    trimmedDescription !== initialDescription.trim();

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
    // `description` is `Option<Option<String>>` on the Rust side: pass
    // `null` to clear, the trimmed string to set, omit to leave alone.
    if (trimmedDescription !== initialDescription.trim()) {
      args.description = trimmedDescription.length > 0 ? trimmedDescription : null;
    }

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

          <Input
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Optional description…"
            data-testid="space-settings-description-input"
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
  );
}
