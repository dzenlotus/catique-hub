/**
 * RoleNoteRow — single curation note body inside `RoleMemorySection`
 * (ctq-137 / MEM-S2).
 *
 * Two states: read (chips + body preview + actions) and edit (inline
 * `RoleNoteForm`). Pin toggle + delete + expand are read-state
 * affordances; Save / Cancel come from the form when editing.
 *
 * The surrounding `<li>` + row chrome (hover overlay, geometry) is
 * owned by `<EntityTree/>`'s `Row` — this component renders only the
 * row BODY through EntityTree's `renderRow` slot. The note id test-id
 * (`role-memory-note-<id>`) lands on the EntityTree row `<li>` via
 * `testIdPrefix`, so it is not stamped here.
 */

import { useState, type ReactElement } from "react";

import { Button } from "@shared/ui";
import { cn } from "@shared/lib";

import {
  useUpdateRoleNoteMutation,
  useDeleteRoleNoteMutation,
  type RoleNote,
} from "@entities/role-note";

import { RoleNoteForm, type RoleNoteDraft } from "./RoleNoteForm";
import { absoluteTime, relativeTime } from "./relativeTime";
import styles from "./RoleMemorySection.module.css";

export interface RoleNoteRowProps {
  note: RoleNote;
  /** Push a toast on success/error. */
  onToast: (kind: "success" | "error", message: string) => void;
}

export function RoleNoteRow({ note, onToast }: RoleNoteRowProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const updateMutation = useUpdateRoleNoteMutation();
  const deleteMutation = useDeleteRoleNoteMutation();

  const sortedTags = [...note.tags].sort((a, b) => a.localeCompare(b));

  const handleTogglePin = (): void => {
    updateMutation.mutate(
      { id: note.id, pinned: !note.pinned },
      {
        onError: (err) => {
          onToast("error", `Failed to update note: ${err.message}`);
        },
      },
    );
  };

  const handleDelete = (): void => {
    const ok = window.confirm("Delete this memory note?");
    if (!ok) return;
    deleteMutation.mutate(
      { id: note.id, roleId: note.roleId },
      {
        onSuccess: () => {
          onToast("success", "Note deleted");
        },
        onError: (err) => {
          onToast("error", `Failed to delete note: ${err.message}`);
        },
      },
    );
  };

  const handleEditSubmit = (draft: RoleNoteDraft): void => {
    setEditError(null);
    updateMutation.mutate(
      {
        id: note.id,
        body: draft.body,
        tags: draft.tags,
        priority: draft.priority,
        pinned: draft.pinned,
      },
      {
        onSuccess: () => {
          setEditing(false);
          onToast("success", "Note saved");
        },
        onError: (err) => {
          setEditError(`Failed to save: ${err.message}`);
        },
      },
    );
  };

  if (editing) {
    return (
      <div
        className={styles.editBody}
        data-testid={`role-memory-note-${note.id}`}
      >
        <RoleNoteForm
          idPrefix={`role-memory-edit-${note.id}`}
          submitLabel="Save"
          initial={{
            body: note.body,
            tags: note.tags,
            priority: Number(note.priority),
            pinned: note.pinned,
          }}
          onSubmit={handleEditSubmit}
          onCancel={() => {
            setEditing(false);
            setEditError(null);
          }}
          errorMessage={editError}
          isPending={updateMutation.status === "pending"}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(styles.row, note.pinned && styles.rowPinned)}
      data-testid={`role-memory-note-${note.id}`}
    >
      <button
        type="button"
        className={styles.rowPin}
        aria-pressed={note.pinned}
        aria-label={note.pinned ? "Unpin note" : "Pin note"}
        title={note.pinned ? "Unpin" : "Pin"}
        onClick={handleTogglePin}
        data-testid={`role-memory-note-${note.id}-pin`}
      >
        {note.pinned ? "★" : "☆"}
      </button>

      <div className={styles.rowBodyCol}>
        <div className={styles.rowMeta}>
          {sortedTags.length > 0 ? (
            <span className={styles.rowTags}>
              {sortedTags.map((tag) => (
                <span
                  key={tag}
                  className={styles.rowTag}
                  data-testid={`role-memory-note-${note.id}-tag-${tag}`}
                >
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
          <span
            className={cn(
              styles.rowAuthor,
              note.authoredBy === "agent" && styles.rowAuthorAgent,
            )}
            data-testid={`role-memory-note-${note.id}-author`}
          >
            {note.authoredBy}
          </span>
          <span
            className={styles.rowPriority}
            data-testid={`role-memory-note-${note.id}-priority`}
          >
            P{note.priority}
          </span>
          <span
            className={styles.rowDate}
            title={absoluteTime(note.createdAt)}
          >
            {relativeTime(note.createdAt)}
          </span>
        </div>

        <p
          className={cn(styles.rowBody, expanded && styles.rowBodyExpanded)}
          data-testid={`role-memory-note-${note.id}-body`}
        >
          {note.body}
        </p>
        {note.body.length > 120 ? (
          <button
            type="button"
            className={styles.rowBodyToggle}
            onClick={() => setExpanded((v) => !v)}
            data-testid={`role-memory-note-${note.id}-toggle`}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>

      <span className={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setEditing(true)}
          data-testid={`role-memory-note-${note.id}-edit`}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isPending={deleteMutation.status === "pending"}
          onPress={handleDelete}
          data-testid={`role-memory-note-${note.id}-delete`}
        >
          Delete
        </Button>
      </span>
    </div>
  );
}
