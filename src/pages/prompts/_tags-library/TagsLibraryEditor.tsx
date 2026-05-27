/**
 * TagsLibraryEditor — wrapping chip-row editor for the global tag set.
 *
 * Reuses `<TagChip>` (the same pill the prompt editor's tags row
 * shows) with its in-chip `×` to detach. Click on a chip enters
 * inline rename mode; Enter saves, Escape aborts. Uses the shared
 * `<ConfirmDialog>` for delete.
 *
 * Self-contained: drives `useTags` / `useUpdateTagMutation` /
 * `useDeleteTagMutation` directly so consumers (PromptsSettings and
 * any future tag-management surface) just drop it in.
 */

import { useState, type ReactElement } from "react";

import {
  TagChip,
  useDeleteTagMutation,
  useTags,
  useUpdateTagMutation,
} from "@entities/tag";
import type { Tag } from "@entities/tag";
import { ConfirmDialog } from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./TagsLibraryEditor.module.css";

export function TagsLibraryEditor(): ReactElement {
  const tagsQuery = useTags();
  const updateMutation = useUpdateTagMutation();
  const deleteMutation = useDeleteTagMutation();
  const { pushToast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);

  const beginRename = (tag: Tag): void => {
    setEditingId(tag.id);
    setDraftName(tag.name);
  };

  const commitRename = (id: string): void => {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      setEditingId(null);
      return;
    }
    updateMutation.mutate(
      { id, name: trimmed },
      {
        onSuccess: () => setEditingId(null),
        onError: (err) => {
          pushToast("error", `Failed to rename tag: ${err.message}`);
        },
      },
    );
  };

  const confirmDelete = (): void => {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete.id, {
      onSuccess: () => setPendingDelete(null),
      onError: (err) => {
        pushToast("error", `Failed to delete tag: ${err.message}`);
        setPendingDelete(null);
      },
    });
  };

  const tags = tagsQuery.data ?? [];

  if (tagsQuery.status === "pending") {
    return <p className={styles.empty}>Loading tags…</p>;
  }
  if (tags.length === 0) {
    return (
      <p className={styles.empty}>
        No tags yet. Create one from the prompt editor.
      </p>
    );
  }

  return (
    <>
      <ul className={styles.list} role="list" data-testid="tags-library-editor">
        {tags.map((tag) =>
          editingId === tag.id ? (
            <li key={tag.id} className={styles.item}>
              <input
                type="text"
                className={styles.renameInput}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitRename(tag.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(tag.id);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                autoFocus
                aria-label={`Rename tag ${tag.name}`}
                data-testid={`tags-library-editor-rename-${tag.id}`}
              />
            </li>
          ) : (
            <li key={tag.id} className={styles.item}>
              <button
                type="button"
                className={styles.editBtn}
                onClick={() => beginRename(tag)}
                aria-label={`Rename tag ${tag.name}`}
                data-testid={`tags-library-editor-edit-${tag.id}`}
              >
                <TagChip
                  tag={tag}
                  onRemove={() => setPendingDelete(tag)}
                />
              </button>
            </li>
          ),
        )}
      </ul>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={
          pendingDelete
            ? `Delete tag "${pendingDelete.name}"?`
            : "Delete tag?"
        }
        description="The tag is removed from every prompt that carries it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        isPending={deleteMutation.status === "pending"}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        data-testid="tags-library-editor-delete-confirm"
      />
    </>
  );
}
