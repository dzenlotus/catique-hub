/**
 * RoleMemorySection — per-role retrospective memory curation
 * (ctq-137 / MEM-S2).
 *
 * Mounted as the last section of `RoleEditor`. Shows the agent's notes
 * for this role, lets the user filter by tag + search, pin / unpin /
 * edit / delete existing notes, and add manual seed notes.
 *
 * The actual heavy lifting lives in sibling files:
 * - `useRoleNoteFilters` — local filter / sort state.
 * - `RoleMemoryFilterBar` — tag chips + search + sort UI.
 * - `RoleNoteRow` — single note row (read vs inline-edit).
 * - `RoleNoteForm` — shared body/tags/priority/pinned form.
 */

import { useState, type ReactElement } from "react";

import { Button, EmptyState } from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";

import {
  useRoleNotes,
  useRoleNoteTags,
  useAddRoleNoteMutation,
  useUpdateRoleNoteMutation,
} from "@entities/role-note";

import { RoleMemoryFilterBar } from "./RoleMemoryFilterBar";
import { RoleNoteRow } from "./RoleNoteRow";
import { RoleNoteForm, type RoleNoteDraft } from "./RoleNoteForm";
import { useRoleNoteFilters } from "./useRoleNoteFilters";
import styles from "./RoleMemorySection.module.css";

export interface RoleMemorySectionProps {
  roleId: string;
}

export function RoleMemorySection({
  roleId,
}: RoleMemorySectionProps): ReactElement {
  const notesQuery = useRoleNotes(roleId);
  const tagsQuery = useRoleNoteTags(roleId);
  const addMutation = useAddRoleNoteMutation();
  const updateMutation = useUpdateRoleNoteMutation();
  const { pushToast } = useToast();

  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const filters = useRoleNoteFilters(notesQuery.data ?? []);

  const handleAddSubmit = (draft: RoleNoteDraft): void => {
    setAddError(null);
    addMutation.mutate(
      { roleId, body: draft.body, tags: draft.tags, authoredBy: "user" },
      {
        onSuccess: (created) => {
          // `add_role_note` doesn't take pinned / priority — server
          // defaults are false / 0. If the user set either in the
          // form, follow up with a single update so the new row
          // reflects the intent immediately.
          if (draft.pinned || draft.priority !== 0) {
            updateMutation.mutate({
              id: created.id,
              pinned: draft.pinned,
              priority: draft.priority,
            });
          }
          setAdding(false);
          pushToast("success", "Note added");
        },
        onError: (err) => {
          setAddError(`Failed to add note: ${err.message}`);
        },
      },
    );
  };

  const hasNotes =
    notesQuery.status === "success" && notesQuery.data.length > 0;
  const isEmpty =
    notesQuery.status === "success" && notesQuery.data.length === 0;
  const hasNoMatches =
    hasNotes && filters.visibleNotes.length === 0;

  return (
    <div className={styles.section} data-testid="role-memory-section">
      <div className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.title}>Memory</p>
          <p className={styles.subtitle}>
            Retrospective notes your agent reads before each task. Pinned
            notes always load.
          </p>
        </div>
        {!adding ? (
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              setAddError(null);
              setAdding(true);
            }}
            data-testid="role-memory-section-add-button"
          >
            + Add note
          </Button>
        ) : null}
      </div>

      {adding ? (
        <RoleNoteForm
          idPrefix="role-memory-add"
          submitLabel="Add"
          onSubmit={handleAddSubmit}
          onCancel={() => {
            setAdding(false);
            setAddError(null);
          }}
          errorMessage={addError}
          isPending={addMutation.status === "pending"}
        />
      ) : null}

      <RoleMemoryFilterBar
        tagCounts={tagsQuery.data ?? []}
        selectedTags={filters.selectedTags}
        onToggleTag={filters.toggleTag}
        onClearTags={filters.clearTags}
        searchInput={filters.searchInput}
        onSearchChange={filters.setSearchInput}
        sort={filters.sort}
        onSortChange={filters.setSort}
      />

      {notesQuery.status === "error" ? (
        <p
          role="alert"
          className={styles.formError}
          data-testid="role-memory-section-error"
        >
          Failed to load notes: {notesQuery.error.message}
        </p>
      ) : null}

      {isEmpty ? (
        <div data-testid="role-memory-section-empty">
          <EmptyState
            title="No notes yet"
            description="Notes are written automatically by the agent after each task it completes; you can also add manual seed notes here."
          />
        </div>
      ) : null}

      {hasNoMatches ? (
        <p
          className={styles.emptyHint}
          data-testid="role-memory-section-no-matches"
        >
          No notes match the current filters.
        </p>
      ) : null}

      {filters.visibleNotes.length > 0 ? (
        <ul className={styles.list} data-testid="role-memory-section-list">
          {filters.visibleNotes.map((note) => (
            <RoleNoteRow key={note.id} note={note} onToast={pushToast} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
