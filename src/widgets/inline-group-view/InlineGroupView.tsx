/**
 * InlineGroupView — right-pane prompt-group surface.
 *
 * Round-19d (user-driven restructure):
 *   - 2-column body. Left = vertical sortable list of prompt cards
 *     (one card width); right = preview pane.
 *   - Preview is Markdown by default (concatenated content of every
 *     prompt in the group, rendered as a single document). While the
 *     user is dragging a card to reorder, the preview swaps to the
 *     XML representation that the agent will see in a task context.
 *   - The droppable region (id `group-content:<id>`) still accepts
 *     prompts dragged in from the sidebar — handled by `<PromptsPage>`.
 */

import { useMemo, type ReactElement } from "react";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";

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
  /**
   * Optimistic order of prompt ids during a drag. Falls back to the
   * server order from `usePromptGroupMembers` when null.
   */
  orderOverride?: ReadonlyArray<string> | null;
}

export function InlineGroupView({
  groupId,
  onSelectPrompt,
  onRenameGroup,
  onDeleteGroup,
  orderOverride = null,
}: InlineGroupViewProps): ReactElement {
  const groupQuery = usePromptGroup(groupId);
  const membersQuery = usePromptGroupMembers(groupId);
  const promptsQuery = usePrompts();
  const removeMember = useRemovePromptGroupMemberMutation();
  const { pushToast } = useToast();

  // Distinct id from the sidebar row droppable (`group:<id>`); the
  // shared `<DragDropProvider>` in `<PromptsPage>` routes both prefixes
  // to the same membership mutation when a sidebar prompt is dropped.
  const { ref, isDropTarget } = useDroppable({
    id: `group-content:${groupId}`,
    type: "group",
    accept: ["prompt"],
  });

  const memberPrompts = useMemo<Prompt[]>(() => {
    const rawIds = orderOverride ?? membersQuery.data ?? [];
    // Optimistic order from the parent comes prefixed (`member:<id>`)
    // because dnd-kit demands globally-unique ids per provider — strip
    // the prefix back to the bare prompt id used by the data layer.
    const ids = rawIds.map((id) =>
      id.startsWith("member:") ? id.slice("member:".length) : id,
    );
    const promptsById = new Map(
      (promptsQuery.data ?? []).map((p) => [p.id, p] as const),
    );
    const ordered: Prompt[] = [];
    for (const id of ids) {
      const prompt = promptsById.get(id);
      if (prompt) ordered.push(prompt);
    }
    return ordered;
  }, [membersQuery.data, promptsQuery.data, orderOverride]);

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
  const groupSortableKey = `group-members-${groupId}`;

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

      <div className={styles.body}>
        <div
          ref={(element) => ref(element)}
          className={styles.listColumn}
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
            memberPrompts.map((prompt, index) => (
              <SortableMemberCard
                key={prompt.id}
                prompt={prompt}
                index={index}
                groupSortableKey={groupSortableKey}
                onSelect={onSelectPrompt}
                onRemove={handleRemoveFromGroup}
                isRemoving={removeMember.isPending}
              />
            ))
          )}
        </div>

        <div className={styles.previewColumn}>
          <div className={styles.previewHeader}>
            <span>Task XML preview</span>
            <span
              className={styles.tokenChip}
              data-testid="inline-group-view-total-tokens"
            >
              {sumTokenCount(memberPrompts)}
            </span>
          </div>
          <div className={styles.previewBody}>
            {memberPrompts.length === 0 ? (
              <p className={styles.previewEmpty}>
                Add prompts to see how they'll render to an agent.
              </p>
            ) : (
              <pre
                className={styles.previewXml}
                data-testid="inline-group-view-xml-preview"
              >
                {renderPromptsXml(memberPrompts, group.name)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sortable card row
// ─────────────────────────────────────────────────────────────────────────────

interface SortableMemberCardProps {
  prompt: Prompt;
  index: number;
  groupSortableKey: string;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  isRemoving: boolean;
}

function SortableMemberCard({
  prompt,
  index,
  groupSortableKey,
  onSelect,
  onRemove,
  isRemoving,
}: SortableMemberCardProps): ReactElement {
  // Distinct id from the sidebar's `useSortable({ id: prompt.id })` —
  // dnd-kit registers entities globally per provider, and two
  // sortables sharing an id under one provider crashes the manager.
  const { ref, handleRef, isDragging } = useSortable({
    id: `member:${prompt.id}`,
    index,
    group: groupSortableKey,
    type: "group-member-prompt",
    accept: ["group-member-prompt"],
  });

  return (
    <div
      ref={(element) => ref(element)}
      className={styles.cardCell}
      data-dragging={isDragging ? "true" : undefined}
      data-testid={`inline-group-view-card-${prompt.id}`}
    >
      <button
        type="button"
        ref={(element) => handleRef(element)}
        className={styles.dragHandle}
        aria-label={`Drag ${prompt.name}`}
        data-testid={`inline-group-view-handle-${prompt.id}`}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <button
        type="button"
        className={styles.removeButton}
        onClick={() => onRemove(prompt.id)}
        disabled={isRemoving}
        aria-label={`Remove ${prompt.name} from group`}
        data-testid={`inline-group-view-remove-${prompt.id}`}
      >
        <span aria-hidden="true">×</span>
      </button>
      <PromptCard
        prompt={prompt}
        onSelect={onSelect}
        className={styles.cardInner}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum the per-prompt `tokenCount` across all members, returning a
 * formatted chip label. Prompts with `null` tokens are skipped (the
 * count is unknown, not zero); when no prompt has a count we show
 * "—" so the header still has a stable trailing label.
 */
function sumTokenCount(prompts: ReadonlyArray<Prompt>): string {
  let total = 0n;
  let any = false;
  for (const p of prompts) {
    const count = p.tokenCount;
    if (count === null || count === undefined) continue;
    // Defensive: Tauri can land i64 as either bigint or number depending
    // on the value range — normalise so the running sum stays bigint.
    total += typeof count === "bigint" ? count : BigInt(count);
    any = true;
  }
  if (!any) return "— tokens";
  return `≈${total.toString()} tokens`;
}

/** Render the group as the XML envelope an agent receives. Mirrors
 * the layout that the task-context build will emit at runtime so the
 * user can preview wire-format ordering as they reorder. */
function renderPromptsXml(
  prompts: ReadonlyArray<Prompt>,
  groupName: string,
): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const lines = [`<prompts group="${escape(groupName)}">`];
  for (const prompt of prompts) {
    lines.push(`  <prompt id="${escape(prompt.id)}" name="${escape(prompt.name)}">`);
    const indented = prompt.content
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    lines.push(indented);
    // Examples follow the prompt body; numbered from 0 for parity with
    // the editor's `#0` / `#1` chips.
    for (let i = 0; i < prompt.examples.length; i += 1) {
      const example = prompt.examples[i] ?? "";
      lines.push(`    <example index="${i}">`);
      const exampleBody = example
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n");
      lines.push(exampleBody);
      lines.push(`    </example>`);
    }
    lines.push(`  </prompt>`);
  }
  lines.push(`</prompts>`);
  return lines.join("\n");
}

