import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";

import {
  SidebarShell,
  SidebarSectionLabel,
  SidebarAddRow,
  SidebarSectionDivider,
} from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";
import { type Prompt, usePrompts } from "@entities/prompt";
import {
  type PromptGroup,
  usePromptGroups,
  useAddPromptGroupMemberMutation,
  useRemovePromptGroupMemberMutation,
  useSetPromptGroupMembersMutation,
} from "@entities/prompt-group";
import { PromptGroupCreateDialog } from "@widgets/prompt-group-create-dialog";
import { PromptCreateDialog } from "@widgets/prompt-create-dialog";

import { GroupRow } from "./GroupRow";
import { PromptRow } from "./PromptRow";
import styles from "./PromptsSidebar.module.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Synthetic group id used by the dnd-kit machinery to represent prompts
 * that are not currently a member of any group. Real PromptGroup ids are
 * UUIDs so collision is impossible. Surfaces in the UI as "All prompts".
 */
const UNGROUPED_KEY = "ungrouped";

// ---------------------------------------------------------------------------
// PromptsSidebar — secondary rail for the merged Prompts page.
// ---------------------------------------------------------------------------

export interface PromptsSidebarProps {
  /** Currently-selected prompt id (drives the active highlight). */
  selectedPromptId: string | null;
  /** Currently-selected group id (`null` = "All prompts" / ungrouped). */
  selectedGroupId: string | null;
  /** Called when the user picks a different group from the top section. */
  onSelectGroup: (groupId: string | null) => void;
  /** Called when the user picks a prompt — opens the editor on the right. */
  onSelectPrompt: (promptId: string) => void;
  /** Called when the user picks "Rename" on a group's kebab. */
  onRenameGroup: (groupId: string) => void;
  /** Called when the user picks "Delete" on a group's kebab. */
  onDeleteGroup: (groupId: string) => void;
}

type GroupBuckets = Record<string, string[]>;

interface SidebarMembership {
  /** Per-group ordered prompt-id lists. Includes the synthetic UNGROUPED_KEY. */
  buckets: GroupBuckets;
  /** id → group id (for stamping the active highlight). */
  promptToGroup: Map<string, string>;
}

/**
 * Build the dnd-kit `Record<groupId, promptId[]>` shape from the loaded
 * prompts + groups. The membership API on the backend is per-group
 * (`list_prompt_group_members`) — but we only render group memberships
 * that the parent page has already loaded, so this widget does NOT
 * fetch them itself; the page passes them in via `groupMembers`.
 */
function buildMembership(
  prompts: Prompt[],
  groups: PromptGroup[],
  groupMembers: Record<string, string[]>,
): SidebarMembership {
  const buckets: GroupBuckets = { [UNGROUPED_KEY]: [] };
  const promptToGroup = new Map<string, string>();

  for (const group of groups) {
    buckets[group.id] = (groupMembers[group.id] ?? []).slice();
    for (const promptId of buckets[group.id]) {
      promptToGroup.set(promptId, group.id);
    }
  }

  for (const prompt of prompts) {
    if (!promptToGroup.has(prompt.id)) {
      buckets[UNGROUPED_KEY].push(prompt.id);
      promptToGroup.set(prompt.id, UNGROUPED_KEY);
    }
  }

  return { buckets, promptToGroup };
}

export interface PromptsSidebarOwnedProps extends PromptsSidebarProps {
  /** Pre-loaded ordered member ids per group. */
  groupMembers: Record<string, string[]>;
}

/**
 * Two-pane secondary rail: groups on top, prompts of the active group
 * on the bottom. Drag-and-drop reorders prompts within a group and
 * moves them across groups.
 */
export function PromptsSidebar({
  selectedPromptId,
  selectedGroupId,
  onSelectGroup,
  onSelectPrompt,
  onRenameGroup,
  onDeleteGroup,
  groupMembers,
}: PromptsSidebarOwnedProps): ReactElement {
  const promptsQuery = usePrompts();
  const groupsQuery = usePromptGroups();

  const addMember = useAddPromptGroupMemberMutation();
  const removeMember = useRemovePromptGroupMemberMutation();
  const setMembers = useSetPromptGroupMembersMutation();

  const { pushToast } = useToast();

  const prompts = promptsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];

  const promptById = useMemo(() => {
    const map = new Map<string, Prompt>();
    for (const prompt of prompts) map.set(prompt.id, prompt);
    return map;
  }, [prompts]);

  const serverMembership = useMemo(
    () => buildMembership(prompts, groups, groupMembers),
    [prompts, groups, groupMembers],
  );

  // Optimistic membership state. Mirrors the kanban pattern (F-04):
  //   - During drag and while a mutation is in flight, the local
  //     `items` map drives the render.
  //   - Once the mutation settles (success or rollback), `serverMembership`
  //     re-syncs.
  const [items, setItems] = useState<GroupBuckets>(serverMembership.buckets);
  const itemsRef = useRef<GroupBuckets>(serverMembership.buckets);
  const draggingRef = useRef(false);

  const isMutating =
    addMember.isPending || removeMember.isPending || setMembers.isPending;

  useEffect(() => {
    if (draggingRef.current) return;
    if (isMutating) return;
    setItems(serverMembership.buckets);
    itemsRef.current = serverMembership.buckets;
  }, [serverMembership, isMutating]);

  const setSyncedItems = useCallback(
    (updater: (current: GroupBuckets) => GroupBuckets): void => {
      setItems((current) => {
        const next = updater(current);
        itemsRef.current = next;
        return next;
      });
    },
    [],
  );

  // ── Dialogs ────────────────────────────────────────────────────────
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);

  // ── Drag handlers ──────────────────────────────────────────────────

  const handleDragStart = useCallback((_event: DragStartEvent): void => {
    draggingRef.current = true;
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent): void => {
      // `move()` from @dnd-kit/helpers handles both intra-group reorder
      // and cross-group transfer — same call shape as KanbanBoard.
      setSyncedItems((current) => move(current, event));
    },
    [setSyncedItems],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      draggingRef.current = false;

      if (event.canceled) {
        // Roll back to last server state.
        setItems(serverMembership.buckets);
        itemsRef.current = serverMembership.buckets;
        return;
      }

      const sourceId = event.operation.source?.id;
      if (typeof sourceId !== "string") return;

      // Where the prompt ended up.
      const targetGroupId = findOwningGroup(itemsRef.current, sourceId);
      const originGroupId = serverMembership.promptToGroup.get(sourceId);
      if (targetGroupId === null || originGroupId === undefined) return;

      const targetIndex = itemsRef.current[targetGroupId]?.indexOf(sourceId);
      if (targetIndex === undefined || targetIndex < 0) return;

      // Same group, same position → no-op.
      if (
        targetGroupId === originGroupId &&
        targetIndex === serverMembership.buckets[originGroupId].indexOf(sourceId)
      ) {
        return;
      }

      // Cross-group move: out of origin (if real group) + into target (if real group).
      const wasInRealGroup = originGroupId !== UNGROUPED_KEY;
      const goingToRealGroup = targetGroupId !== UNGROUPED_KEY;

      if (originGroupId !== targetGroupId && wasInRealGroup) {
        removeMember.mutate(
          { groupId: originGroupId, promptId: sourceId },
          {
            onError: (err) => {
              pushToast(
                "error",
                `Failed to remove prompt from group: ${err.message}`,
              );
              void promptsQuery.refetch();
            },
          },
        );
      }

      if (originGroupId !== targetGroupId && goingToRealGroup) {
        addMember.mutate(
          {
            groupId: targetGroupId,
            promptId: sourceId,
            position: BigInt(targetIndex),
          },
          {
            onError: (err) => {
              pushToast(
                "error",
                `Failed to add prompt to group: ${err.message}`,
              );
              void promptsQuery.refetch();
            },
          },
        );
        return;
      }

      // Same-group reorder OR cross-group landing in a real group already
      // handled above. For pure intra-group reorder inside a real group,
      // replace the entire ordered member list.
      if (originGroupId === targetGroupId && goingToRealGroup) {
        const orderedPromptIds = itemsRef.current[targetGroupId];
        setMembers.mutate(
          { groupId: targetGroupId, orderedPromptIds },
          {
            onError: (err) => {
              pushToast(
                "error",
                `Failed to reorder prompts: ${err.message}`,
              );
              void promptsQuery.refetch();
            },
          },
        );
      }
      // Same-group reorder inside UNGROUPED_KEY is purely client-side —
      // there's no backend ordering for ungrouped prompts.
    },
    [
      serverMembership,
      addMember,
      removeMember,
      setMembers,
      pushToast,
      promptsQuery,
    ],
  );

  // ── Render ─────────────────────────────────────────────────────────

  const renderGroupsBody = (): ReactElement => {
    if (groupsQuery.status === "pending") {
      return (
        <div className={styles.bodyEmpty} aria-hidden="true">
          <span className={styles.bodyEmptyText}>Loading groups…</span>
        </div>
      );
    }

    if (groupsQuery.status === "error") {
      return (
        <div className={styles.bodyError} role="alert">
          Failed to load groups: {groupsQuery.error.message}
        </div>
      );
    }

    return (
      <ul className={styles.groupList} role="list">
        <li className={styles.groupItem}>
          <div
            className={`${styles.groupRow} ${styles.allPromptsRow}${
              selectedGroupId === null ? ` ${styles.groupRowActive}` : ""
            }`}
            data-testid="prompts-sidebar-group-row-all"
          >
            {selectedGroupId === null && (
              <span className={styles.groupActiveStrip} aria-hidden="true" />
            )}
            <button
              type="button"
              className={styles.groupName}
              onClick={() => onSelectGroup(null)}
              aria-current={selectedGroupId === null ? "page" : undefined}
              aria-label="All prompts"
              data-testid="prompts-sidebar-group-select-all"
            >
              All prompts
            </button>
          </div>
        </li>
        {groups.map((group) => (
          <GroupRow
            key={group.id}
            group={group}
            isActive={group.id === selectedGroupId}
            onSelect={onSelectGroup}
            onRename={onRenameGroup}
            onDelete={onDeleteGroup}
          />
        ))}
      </ul>
    );
  };

  // Determine which prompts to show in the bottom section.
  const visibleGroupKey = selectedGroupId ?? UNGROUPED_KEY;
  const visiblePromptIds = items[visibleGroupKey] ?? [];

  const renderPromptsBody = (): ReactElement => {
    if (promptsQuery.status === "pending") {
      return (
        <div className={styles.bodyEmpty} aria-hidden="true">
          <span className={styles.bodyEmptyText}>Loading prompts…</span>
        </div>
      );
    }
    if (promptsQuery.status === "error") {
      return (
        <div className={styles.bodyError} role="alert">
          Failed to load prompts: {promptsQuery.error.message}
        </div>
      );
    }
    if (visiblePromptIds.length === 0) {
      return (
        <div className={styles.bodyEmpty}>
          <span className={styles.bodyEmptyText}>
            {selectedGroupId === null
              ? "No ungrouped prompts."
              : "This group has no prompts yet."}
          </span>
        </div>
      );
    }

    return (
      <ul
        className={styles.promptList}
        role="list"
        data-testid={`prompts-sidebar-prompt-list-${visibleGroupKey}`}
      >
        {visiblePromptIds.map((promptId, index) => {
          const prompt = promptById.get(promptId);
          if (!prompt) return null;
          return (
            <PromptRow
              key={prompt.id}
              prompt={prompt}
              index={index}
              groupId={visibleGroupKey}
              isActive={prompt.id === selectedPromptId}
              onSelect={onSelectPrompt}
            />
          );
        })}
      </ul>
    );
  };

  return (
    <>
      <DragDropProvider
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <SidebarShell
          ariaLabel="Prompts navigation"
          testId="prompts-sidebar-root"
        >
          <SidebarSectionLabel ariaLabel="Groups">GROUPS</SidebarSectionLabel>
          {renderGroupsBody()}
          {groupsQuery.status === "success" ? (
            <SidebarAddRow
              label="Add group"
              onPress={() => setIsGroupDialogOpen(true)}
              testId="prompts-sidebar-add-group"
            />
          ) : null}

          <SidebarSectionDivider />

          <SidebarSectionLabel ariaLabel="Prompts">
            {selectedGroupId === null ? "ALL PROMPTS" : "PROMPTS"}
          </SidebarSectionLabel>
          {renderPromptsBody()}
          {promptsQuery.status === "success" ? (
            <SidebarAddRow
              label="Add prompt"
              onPress={() => setIsPromptDialogOpen(true)}
              testId="prompts-sidebar-add-prompt"
            />
          ) : null}
        </SidebarShell>
      </DragDropProvider>

      <PromptGroupCreateDialog
        isOpen={isGroupDialogOpen}
        onClose={() => setIsGroupDialogOpen(false)}
        onCreated={(group) => onSelectGroup(group.id)}
      />

      <PromptCreateDialog
        isOpen={isPromptDialogOpen}
        onClose={() => setIsPromptDialogOpen(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findOwningGroup(
  buckets: GroupBuckets,
  promptId: string,
): string | null {
  for (const [groupId, ids] of Object.entries(buckets)) {
    if (ids.includes(promptId)) return groupId;
  }
  return null;
}
