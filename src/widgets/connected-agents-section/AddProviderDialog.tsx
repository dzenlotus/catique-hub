/**
 * AddProviderDialog — modal listing supported providers (round-21).
 *
 * The user picks a provider from a single-select list; on confirm we
 * call `useAddProviderMutation` (`add_provider` IPC). After success,
 * the modal closes and the connected-providers list refetches via the
 * mutation's `onSuccess` invalidation.
 *
 * Mirrors the look-and-feel of `SpaceCreateDialog`: shared `Dialog`
 * wrapper, sectioned body, Save/Cancel footer with primary/ghost
 * buttons.
 */

import { useState, type ReactElement, type Key } from "react";

import {
  Button,
  Dialog,
  Listbox,
  ListboxItem,
} from "@shared/ui";
import {
  useAddProviderMutation,
  useConnectedClients,
  useSupportedProviders,
  type SupportedProvider,
} from "@entities/connected-client";

import styles from "./AddProviderDialog.module.css";

export interface AddProviderDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * `AddProviderDialog` — controlled modal. Keeps internal "selected id"
 * state so the confirm button can be disabled while the user has not
 * picked a row.
 */
export function AddProviderDialog({
  isOpen,
  onClose,
}: AddProviderDialogProps): ReactElement {
  return (
    <Dialog
      title="Add provider"
      description="Connect a supported agentic client. Catique will sync its agents into the provider's config and add the catique-hub MCP entry."
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="add-provider-dialog"
    >
      {() => <AddProviderDialogContent onClose={onClose} />}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface AddProviderDialogContentProps {
  onClose: () => void;
}

function AddProviderDialogContent({
  onClose,
}: AddProviderDialogContentProps): ReactElement {
  const supportedQuery = useSupportedProviders();
  const connectedQuery = useConnectedClients();
  const addMutation = useAddProviderMutation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Filter out ids that are already connected so we don't show
  // duplicates in the picker.
  const connectedIds = new Set(
    (connectedQuery.data ?? []).map((c) => c.id),
  );
  const supported: SupportedProvider[] =
    (supportedQuery.data ?? []).filter((p) => !connectedIds.has(p.id));

  const canSubmit = selectedId !== null && !addMutation.isPending;

  const handleSelectionChange = (keys: "all" | Set<Key>): void => {
    // Listbox in single-select mode emits a Set with at most one key.
    if (keys === "all") return;
    const first = keys.values().next();
    setSelectedId(first.done ? null : String(first.value));
  };

  const handleConfirm = (): void => {
    if (selectedId === null) return;
    setSaveError(null);
    addMutation.mutate(selectedId, {
      onSuccess: () => {
        onClose();
      },
      onError: (err) => {
        setSaveError(`Failed to add: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    onClose();
  };

  // ── Pending ────────────────────────────────────────────────────────
  if (supportedQuery.status === "pending") {
    return (
      <>
        <div
          className={styles.section}
          data-testid="add-provider-dialog-loading"
        >
          <p className={styles.message}>Loading supported providers…</p>
        </div>
        <DialogFooterActions
          isDisabled
          isPending={false}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        />
      </>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────
  if (supportedQuery.status === "error") {
    return (
      <>
        <div
          className={styles.section}
          role="alert"
          data-testid="add-provider-dialog-error"
        >
          <p className={styles.errorMessage}>
            Failed to load supported providers:{" "}
            {supportedQuery.error.message}
          </p>
        </div>
        <DialogFooterActions
          isDisabled
          isPending={false}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        />
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────
  return (
    <>
      <div className={styles.section}>
        {supported.length === 0 ? (
          <p
            className={styles.message}
            data-testid="add-provider-dialog-all-connected"
          >
            All supported providers are already connected.
          </p>
        ) : (
          <Listbox
            aria-label="Supported providers"
            selectionMode="single"
            selectedKeys={
              selectedId === null ? new Set() : new Set([selectedId])
            }
            onSelectionChange={handleSelectionChange}
            items={supported}
            data-testid="add-provider-dialog-listbox"
          >
            {(item) => (
              <ListboxItem
                id={item.id}
                textValue={item.displayName}
                data-testid={`add-provider-dialog-option-${item.id}`}
              >
                <span className={styles.optionName}>{item.displayName}</span>
                <span className={styles.optionId}>{item.id}</span>
              </ListboxItem>
            )}
          </Listbox>
        )}
      </div>

      {saveError !== null ? (
        <p
          className={styles.errorMessage}
          role="alert"
          data-testid="add-provider-dialog-save-error"
        >
          {saveError}
        </p>
      ) : null}

      <DialogFooterActions
        isDisabled={!canSubmit}
        isPending={addMutation.isPending}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer — extracted because every render-state (loaded / pending / error)
// renders the same Cancel + Add pair.
// ─────────────────────────────────────────────────────────────────────────────

interface DialogFooterActionsProps {
  isDisabled: boolean;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function DialogFooterActions({
  isDisabled,
  isPending,
  onCancel,
  onConfirm,
}: DialogFooterActionsProps): ReactElement {
  return (
    <div className={styles.footer}>
      <Button
        variant="ghost"
        size="md"
        onPress={onCancel}
        data-testid="add-provider-dialog-cancel"
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        size="md"
        isPending={isPending}
        isDisabled={isDisabled}
        onPress={onConfirm}
        data-testid="add-provider-dialog-confirm"
      >
        Add
      </Button>
    </div>
  );
}
