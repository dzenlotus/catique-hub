/**
 * InlineGroupView — right-pane prompt-group surface (round-19d).
 *
 * Shown by `<PromptsPage>` when a group is selected in the sidebar.
 * Hosts:
 *   - Group header (name, swatch, "Edit group" / "Delete" actions).
 *   - The group's member prompts as a card grid.
 *   - A droppable region: dragging a prompt from the sidebar onto this
 *     view adds it to the group (handled by the parent via the shared
 *     `<DragDropProvider>`). The droppable id is `group:<id>` — i.e.
 *     the same id as the sidebar group row, so the existing handler in
 *     `<PromptsSidebar>` already knows how to react. Both surfaces
 *     register the same id; @dnd-kit treats them as one logical drop
 *     target keyed by id.
 */

import { useMemo, type ReactElement } from "react";
import { useDroppable } from "@dnd-kit/react";

import {
  PromptCard,
  usePrompts,
  type Prompt,
} from "@entities/prompt";
import {
  usePromptGroup,
  usePromptGroupMembers,
  useRemovePromptGroupMemberMutation,
} from "@entities/prompt-group";
import { Button, MenuTrigger, Menu, MenuItem } from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./InlineGroupView.module.css";

export interface InlineGroupViewProps {
  groupId: string;
  /** Open the prompt editor (right-pane swap) for the chosen prompt. */
  onSelectPrompt: (id: string) => void;
  /** Open the rename modal for this group. */
  onRenameGroup: (id: string) => void;
  /** Trigger group deletion. */
  onDeleteGroup: (id: string) => void;
}

export function InlineGroupView({
  groupId,
  onSelectPrompt,
  onRenameGroup,
  onDeleteGroup,
}: InlineGroupViewProps): ReactElement {
  const groupQuery = usePromptGroup(groupId);
  const membersQuery = usePromptGroupMembers(groupId);
  const promptsQuery = usePrompts();
  const removeMember = useRemovePromptGroupMemberMutation();
  const { pushToast } = useToast();

  // Distinct id from the sidebar row droppable (`group:<id>`); the
  // shared `<DragDropProvider>` in `<PromptsPage>` routes both prefixes
  // to the same membership mutation.
  const { ref, isDropTarget } = useDroppable({
    id: `group-content:${groupId}`,
    type: "group",
    accept: ["prompt"],
  });

  const memberPrompts = useMemo<Prompt[]>(() => {
    const ids = membersQuery.data ?? [];
    const promptsById = new Map(
      (promptsQuery.data ?? []).map((p) => [p.id, p] as const),
    );
    const ordered: Prompt[] = [];
    for (const id of ids) {
      const prompt = promptsById.get(id);
      if (prompt) ordered.push(prompt);
    }
    return ordered;
  }, [membersQuery.data, promptsQuery.data]);

  const handleRemoveFromGroup = (promptId: string): void => {
    removeMember.mutate(
      { groupId, promptId },
      {
        onSuccess: () => pushToast("success", "Prompt removed from group"),
        onError: (err) =>
          pushToast(
            "error",
            `Failed to remove prompt from group: ${err.message}`,
          ),
      },
    );
  };

  if (groupQuery.status === "pending") {
    return (
      <section
        className={styles.root}
        aria-label="Prompt group"
        data-testid="inline-group-view"
      >
        <p className={styles.dropHint}>Loading group…</p>
      </section>
    );
  }

  if (groupQuery.status === "error") {
    return (
      <section
        className={styles.root}
        aria-label="Prompt group"
        data-testid="inline-group-view"
      >
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="inline-group-view-error"
        >
          Failed to load group: {groupQuery.error.message}
        </div>
      </section>
    );
  }

  if (!groupQuery.data) {
    return (
      <section
        className={styles.root}
        aria-label="Prompt group"
        data-testid="inline-group-view"
      >
        <p className={styles.dropHint}>Group not found.</p>
      </section>
    );
  }

  const group = groupQuery.data;

  return (
    <section
      className={styles.root}
      aria-label={`Prompt group ${group.name}`}
      data-testid="inline-group-view"
    >
      <header className={styles.header}>
        <span
          className={styles.swatch}
          style={
            group.color !== null ? { backgroundColor: group.color } : undefined
          }
          aria-hidden="true"
        />
        <h2 className={styles.title}>{group.name}</h2>
        <div className={styles.actions}>
          <MenuTrigger>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Group actions"
              data-testid="inline-group-view-menu"
            >
              ⋯
            </Button>
            <Menu
              onAction={(key) => {
                if (key === "rename") onRenameGroup(group.id);
                else if (key === "delete") onDeleteGroup(group.id);
              }}
            >
              <MenuItem id="rename">Rename</MenuItem>
              <MenuItem id="delete">Delete</MenuItem>
            </Menu>
          </MenuTrigger>
        </div>
      </header>

      <div
        ref={(element) => ref(element)}
        className={styles.dropZone}
        data-drop-target={isDropTarget ? "true" : undefined}
        data-testid="inline-group-view-drop-zone"
      >
        {memberPrompts.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No prompts in this group yet</p>
            <p className={styles.emptyHint}>
              Drag prompts from the sidebar onto the group to add them.
            </p>
          </div>
        ) : (
          <div
            className={styles.grid}
            data-testid="inline-group-view-grid"
          >
            {memberPrompts.map((prompt) => (
              <div key={prompt.id} className={styles.cardCell}>
                <PromptCard prompt={prompt} onSelect={onSelectPrompt} />
                <div className={styles.cardActions}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => handleRemoveFromGroup(prompt.id)}
                    isPending={removeMember.isPending}
                    data-testid={`inline-group-view-remove-${prompt.id}`}
                  >
                    Remove from group
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
