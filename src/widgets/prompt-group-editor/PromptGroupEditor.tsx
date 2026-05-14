/**
 * PromptGroupEditor — group detail / edit modal.
 *
 * Props:
 *   - `groupId` — null → dialog closed; string → dialog open for that group.
 *   - `onClose` — called on Cancel, successful Save, or Esc (via RAC).
 *
 * Sections:
 *   1. Metadata: name, color (saved via Save button).
 *   2. Members: ordered prompt list with add/remove (immediate save on action).
 *
 * Member operations fire immediately without a Save gate — they use
 * useAddPromptGroupMemberMutation and useRemovePromptGroupMemberMutation
 * directly. Only the metadata fields (name/color) go through the
 * Save/Cancel footer.
 *
 * Audit-#12: the explicit `position` field was removed. Group ordering is
 * driven by drag-reorder in the prompts page; the entity still persists
 * `position` server-side, but exposing a numeric input was vestigial.
 */

import { useEffect, useState, useMemo, type ReactElement } from "react";

import {
  usePromptGroup,
  usePromptGroupMembers,
  useUpdatePromptGroupMutation,
  useAddPromptGroupMemberMutation,
  useRemovePromptGroupMemberMutation,
} from "@entities/prompt-group";
import { usePrompts, usePrompt } from "@entities/prompt";
import {
  Dialog,
  Button,
  IconColorPicker,
  Input,
  Combobox,
  type ComboboxItem,
} from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./PromptGroupEditor.module.css";

export interface PromptGroupEditorProps {
  /** null = closed, string = open for this group id */
  groupId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `PromptGroupEditor` — modal for viewing and editing a prompt group's
 * metadata and member prompts.
 */
export function PromptGroupEditor({
  groupId,
  onClose,
}: PromptGroupEditorProps): ReactElement {
  const isOpen = groupId !== null;

  return (
    <Dialog
      title="Prompt group"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="prompt-group-editor"
    >
      {() =>
        groupId !== null ? (
          <PromptGroupEditorContent groupId={groupId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptGroupEditorContentProps {
  groupId: string;
  onClose: () => void;
}

function PromptGroupEditorContent({
  groupId,
  onClose,
}: PromptGroupEditorContentProps): ReactElement {
  const query = usePromptGroup(groupId);
  const updateMutation = useUpdatePromptGroupMutation();

  // Local edit state — initialised from the loaded group.
  const [localName, setLocalName] = useState("");
  const [localColor, setLocalColor] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when group data loads or groupId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalColor(query.data.color ?? "");
      setSaveError(null);
    }
  }, [query.data, groupId]);

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
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="prompt-group-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="prompt-group-editor-save"
          >
            Save
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
          data-testid="prompt-group-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load group: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-group-editor-cancel"
          >
            Close
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
          data-testid="prompt-group-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>Group not found.</p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-group-editor-cancel"
          >
            Close
          </Button>
        </div>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const group = query.data;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    const resolvedColor = localColor === "" ? null : localColor;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: group.id };

    if (trimmedName !== group.name) {
      mutationArgs.name = trimmedName;
    }
    if (resolvedColor !== group.color) {
      mutationArgs.color = resolvedColor;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        onClose();
      },
      onError: (err) => {
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
    <>
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Name"
          value={localName}
          onChange={setLocalName}
          placeholder="Group name"
          className={styles.fullWidthInput}
          data-testid="prompt-group-editor-name-input"
        />
      </div>

      {/* Color (canonical IconColorPicker — color-only mode). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Color</p>
        <IconColorPicker
          value={{ icon: null, color: localColor === "" ? null : localColor }}
          onChange={(next) => setLocalColor(next.color ?? "")}
          ariaLabel="Group color"
          data-testid="prompt-group-editor-color-input"
        />
      </div>

      {/* Members */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Prompts</p>
        <MembersSection groupId={group.id} />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-group-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-group-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="prompt-group-editor-save"
        >
          Save
        </Button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MembersSection — current members list + add combobox

interface MembersSectionProps {
  groupId: string;
}

function MembersSection({ groupId }: MembersSectionProps): ReactElement {
  const membersQuery = usePromptGroupMembers(groupId);
  const allPromptsQuery = usePrompts();
  const addMutation = useAddPromptGroupMemberMutation();

  const [filterValue, setFilterValue] = useState("");

  const memberIds: string[] = membersQuery.data ?? [];

  // Build combobox items from all prompts, excluding already-members.
  const comboboxItems = useMemo<ComboboxItem[]>(() => {
    const prompts = allPromptsQuery.data ?? [];
    const memberSet = new Set(memberIds);
    return prompts
      .filter((p) => !memberSet.has(p.id))
      .filter(
        (p) =>
          filterValue.trim() === "" ||
          p.name.toLowerCase().includes(filterValue.toLowerCase()),
      )
      .map((p) => ({ id: p.id, label: p.name }));
  }, [allPromptsQuery.data, memberIds, filterValue]);

  const handleAddMember = (key: string | number): void => {
    const promptId = String(key);
    const position = BigInt(memberIds.length);
    addMutation.mutate({ groupId, promptId, position });
    setFilterValue("");
  };

  return (
    <div className={styles.membersSection}>
      {membersQuery.status === "pending" ? (
        <div className={styles.membersSkeleton} aria-hidden="true" />
      ) : membersQuery.status === "error" ? (
        <p className={styles.membersError}>
          Failed to load group prompts.
        </p>
      ) : memberIds.length === 0 ? (
        <p className={styles.membersEmpty}>No prompts in this group yet.</p>
      ) : (
        <ul className={styles.memberList} aria-label="Group prompts">
          {memberIds.map((promptId) => (
            <MemberRow
              key={promptId}
              promptId={promptId}
              groupId={groupId}
            />
          ))}
        </ul>
      )}

      {/* Add member combobox */}
      <div
        className={styles.addMemberRow}
        data-testid="prompt-group-editor-add-member"
      >
        <Combobox
          label="Add prompt"
          items={comboboxItems}
          placeholder="Search prompts…"
          inputValue={filterValue}
          onInputChange={setFilterValue}
          onSelectionChange={(key) => {
            if (key !== null) handleAddMember(key);
          }}
          emptyState={
            <span className={styles.comboboxEmpty}>
              {allPromptsQuery.status === "pending"
                ? "Loading…"
                : "No prompts found"}
            </span>
          }
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberRow — single member pill with remove button.

interface MemberRowProps {
  promptId: string;
  groupId: string;
}

function MemberRow({ promptId, groupId }: MemberRowProps): ReactElement {
  const promptQuery = usePrompt(promptId);
  const removeMutation = useRemovePromptGroupMemberMutation();

  const name =
    promptQuery.status === "pending"
      ? "…"
      : promptQuery.status === "error"
        ? promptId
        : (promptQuery.data?.name ?? promptId);

  return (
    <li
      className={styles.memberRow}
      data-testid={`prompt-group-editor-member-${promptId}`}
    >
      <span className={styles.memberName} title={name}>
        {name}
      </span>
      <button
        type="button"
        className={styles.memberRemoveBtn}
        aria-label={`Remove prompt ${name}`}
        data-testid={`prompt-group-editor-remove-member-${promptId}`}
        onClick={() => removeMutation.mutate({ groupId, promptId })}
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}
