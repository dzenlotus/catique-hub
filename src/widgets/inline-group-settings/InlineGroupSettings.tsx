/**
 * InlineGroupSettings — right-pane settings page for a prompt group.
 *
 * Round-19d: replaces the modal-based group editor with an inline
 * settings page accessed from the "Settings" item on a group's kebab
 * menu in the sidebar. Hosts:
 *   - Name field (controlled).
 *   - Appearance: combined icon + color via `<IconColorPicker>`.
 *   - Danger zone: delete (confirm + parent handler).
 *
 * Member management lives in `<InlineGroupView>` — the user opens
 * the group itself for that, opens Settings only to tweak metadata.
 */

import { useEffect, useState, type ReactElement } from "react";

import {
  usePromptGroup,
  useUpdatePromptGroupMutation,
} from "@entities/prompt-group";
import {
  Button,
  Input,
  IconColorPicker,
} from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./InlineGroupSettings.module.css";

export interface InlineGroupSettingsProps {
  groupId: string;
  /** Called after save / cancel — parent decides where to navigate. */
  onClose: () => void;
  /** Trigger group deletion — confirm flow lives in the parent. */
  onDelete: (groupId: string) => void;
}

export function InlineGroupSettings({
  groupId,
  onClose,
  onDelete,
}: InlineGroupSettingsProps): ReactElement {
  const query = usePromptGroup(groupId);
  const updateMutation = useUpdatePromptGroupMutation();
  const { pushToast } = useToast();

  const [localName, setLocalName] = useState("");
  const [localColor, setLocalColor] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalColor(query.data.color ?? "");
      setSaveError(null);
    }
  }, [query.data, groupId]);

  if (query.status === "pending") {
    return (
      <section
        className={styles.root}
        aria-label="Group settings"
        data-testid="inline-group-settings"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Loading…</h2>
        </header>
      </section>
    );
  }

  if (query.status === "error") {
    return (
      <section
        className={styles.root}
        aria-label="Group settings"
        data-testid="inline-group-settings"
      >
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="inline-group-settings-error"
        >
          Failed to load group: {query.error.message}
        </div>
      </section>
    );
  }

  if (!query.data) {
    return (
      <section
        className={styles.root}
        aria-label="Group settings"
        data-testid="inline-group-settings"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Group not found</h2>
        </header>
      </section>
    );
  }

  const group = query.data;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const args: MutationArgs = { id: group.id };
    if (trimmedName !== group.name) args.name = trimmedName;
    const resolvedColor = localColor === "" ? null : localColor;
    if (resolvedColor !== group.color) args.color = resolvedColor;

    updateMutation.mutate(args, {
      onSuccess: () => {
        pushToast("success", "Group saved");
      },
      onError: (err) => {
        pushToast("error", `Failed to save group: ${err.message}`);
        setSaveError(`Failed to save: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    setLocalName(group.name);
    setLocalColor(group.color ?? "");
    setSaveError(null);
    onClose();
  };

  return (
    <section
      className={styles.root}
      aria-label={`Settings for ${group.name}`}
      data-testid="inline-group-settings"
    >
      <div className={styles.backRow}>
        <Button
          variant="ghost"
          size="sm"
          onPress={onClose}
          data-testid="inline-group-settings-back"
        >
          ← Back
        </Button>
      </div>
      <header className={styles.header}>
        <h2 className={styles.title}>{group.name} · Settings</h2>
      </header>

      <div className={styles.body}>
        <div className={styles.section}>
          <Input
            label="Name"
            value={localName}
            onChange={setLocalName}
            placeholder="Group name"
            className={styles.fullWidthInput}
            data-testid="inline-group-settings-name-input"
          />
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>Appearance</p>
          <p className={styles.sectionHint}>
            Picks the leading swatch shown in the sidebar and on the
            group's card.
          </p>
          <IconColorPicker
            value={{
              icon: null,
              color: localColor === "" ? null : localColor,
            }}
            onChange={(next) => {
              setLocalColor(next.color ?? "");
            }}
            ariaLabel="Group color"
            data-testid="inline-group-settings-appearance"
          />
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>Danger zone</p>
          <div className={styles.dangerZone}>
            <h3 className={styles.dangerHeading}>Delete this group</h3>
            <p className={styles.dangerHint}>
              The group is removed and prompts inside it become
              ungrouped. Prompt content is not affected.
            </p>
            <div>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => onDelete(group.id)}
                data-testid="inline-group-settings-delete"
              >
                Delete group
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="inline-group-settings-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="inline-group-settings-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="inline-group-settings-save"
        >
          Save
        </Button>
      </div>
    </section>
  );
}
