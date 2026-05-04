import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";

import {
  promptGroupsKeys,
  listPromptGroupMembers,
  useAddPromptGroupMemberMutation,
  useDeletePromptGroupMutation,
  usePromptGroups,
  useRemovePromptGroupMemberMutation,
  useSetPromptGroupMembersMutation,
} from "@entities/prompt-group";
import {
  promptsKeys,
  recomputePromptTokenCount,
  usePrompts,
} from "@entities/prompt";
import { useToast } from "@app/providers/ToastProvider";
import { Scrollable } from "@shared/ui";
import { PromptsList } from "@widgets/prompts-list";
import { PromptEditorPanel } from "@widgets/prompt-editor-panel";
import { PromptGroupEditor } from "@widgets/prompt-group-editor";
import { PromptsSidebar } from "@widgets/prompts-sidebar";
import { InlineGroupView } from "@widgets/inline-group-view";

import styles from "./PromptsPage.module.css";

// ---------------------------------------------------------------------------
// PromptsPage — merged Prompts + Prompt Groups view (round-19d).
//
// Right-pane router:
//   - selectedPromptId !== null  → inline `<PromptEditorPanel>` (no modal).
//   - selectedGroupId  !== null  → `<InlineGroupView>` of that group.
//   - both null                  → `<PromptsList>` grid (default landing).
//
// DnD is owned at this level so the sidebar's draggable rows and the
// inline group view's droppable area share one provider. Drop targets:
//   - sidebar group row     id = `group:<id>`
//   - inline group view     id = `group-content:<id>`  (different id;
//     both mean "drop on this group" — the handler routes them to the
//     same membership mutation).
// ---------------------------------------------------------------------------

export function PromptsPage(): ReactElement {
  const groupsQuery = usePromptGroups();
  const promptsQuery = usePrompts();
  const queryClient = useQueryClient();
  const deleteGroup = useDeletePromptGroupMutation();
  const addMember = useAddPromptGroupMemberMutation();
  const removeMember = useRemovePromptGroupMemberMutation();
  const setMembers = useSetPromptGroupMembersMutation();
  const { pushToast } = useToast();

  // ── Token-count backfill (round-19d) ────────────────────────────────
  // Per the user's "all prompts must always have token counts"
  // requirement: when the prompts list lands, scan for entries with
  // `tokenCount === null` and fire `recompute_prompt_token_count` for
  // each (fire-and-forget). A ref tracks ids we've already attempted
  // so a single null prompt doesn't loop on every render.
  const backfillAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const list = promptsQuery.data;
    if (!list || list.length === 0) return;
    const targets = list.filter(
      (p) => p.tokenCount === null && !backfillAttemptedRef.current.has(p.id),
    );
    if (targets.length === 0) return;
    for (const prompt of targets) {
      backfillAttemptedRef.current.add(prompt.id);
      void recomputePromptTokenCount(prompt.id)
        .then(() => {
          void queryClient.invalidateQueries({
            queryKey: promptsKeys.detail(prompt.id),
          });
          void queryClient.invalidateQueries({
            queryKey: promptsKeys.list(),
          });
        })
        .catch(() => {
          // Silent: leave the count null until the next session retries.
        });
    }
  }, [promptsQuery.data, queryClient]);

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Optimistic reorder state for `<InlineGroupView>` sortable cards.
  // `reorderGroupId` is the group whose members are being dragged;
  // `reorderItems` mirrors the @dnd-kit `move()` bucket shape so the
  // helper can shuffle ids in-place during drag-over.
  const [reorderGroupId, setReorderGroupId] = useState<string | null>(null);
  const [reorderItems, setReorderItems] = useState<Record<string, string[]>>({});
  const reorderItemsRef = useRef<Record<string, string[]>>({});

  // Per-group ordered member-id list (parallel queries).
  const memberQueries = useQueries({
    queries: groups.map((group) => ({
      queryKey: promptGroupsKeys.members(group.id),
      queryFn: () => listPromptGroupMembers(group.id),
    })),
  });

  const groupMembers = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    groups.forEach((group, index) => {
      const data = memberQueries[index]?.data;
      if (Array.isArray(data)) map[group.id] = data;
    });
    return map;
  }, [groups, memberQueries]);

  // promptId → owning groupId (null when not in any group).
  const promptToGroup = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const [groupId, ids] of Object.entries(groupMembers)) {
      for (const id of ids) map.set(id, groupId);
    }
    return map;
  }, [groupMembers]);

  function handleDeleteGroup(groupId: string): void {
    deleteGroup.mutate(groupId, {
      onSuccess: () => {
        pushToast("success", "Group deleted");
        if (selectedGroupId === groupId) setSelectedGroupId(null);
      },
      onError: (err) => {
        pushToast("error", `Failed to delete group: ${err.message}`);
      },
    });
  }

  // ── Drag start: open optimistic-reorder state for the source group ──
  // Source id arrives as `member:<promptId>` (see `<SortableMemberCard>`)
  // — strip the prefix to find the owner group, then initialise the
  // optimistic bucket with the prefixed ids that match the dnd-kit
  // sortable registrations.
  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const sourceType = event.operation.source?.type;
      const sourceId = event.operation.source?.id;
      if (sourceType !== "group-member-prompt") return;
      if (typeof sourceId !== "string") return;
      const promptId = sourceId.startsWith("member:")
        ? sourceId.slice("member:".length)
        : sourceId;
      const ownerGroupId = promptToGroup.get(promptId);
      if (!ownerGroupId) return;
      const initialIds = (groupMembers[ownerGroupId] ?? []).map(
        (id) => `member:${id}`,
      );
      const bucket = { [`group-members-${ownerGroupId}`]: initialIds };
      reorderItemsRef.current = bucket;
      setReorderItems(bucket);
      setReorderGroupId(ownerGroupId);
    },
    [promptToGroup, groupMembers],
  );

  // ── Drag over: shuffle the bucket via @dnd-kit's `move()` helper ────
  const handleDragOver = useCallback(
    (event: DragOverEvent): void => {
      if (reorderGroupId === null) return;
      setReorderItems((current) => {
        const next = move(current, event);
        reorderItemsRef.current = next;
        return next;
      });
    },
    [reorderGroupId],
  );

  // ── Drag end: persist the new order OR add-to-group ────────────────
  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      // Reorder branch — settle the drop into a `set_prompt_group_members`
      // mutation against the captured group id. Strip the `member:`
      // prefix so the wire payload is the bare prompt-id list.
      if (reorderGroupId !== null) {
        const groupKey = `group-members-${reorderGroupId}`;
        const nextPrefixed = reorderItemsRef.current[groupKey] ?? [];
        const nextOrder = nextPrefixed.map((id) =>
          id.startsWith("member:") ? id.slice("member:".length) : id,
        );
        const initialOrder = groupMembers[reorderGroupId] ?? [];
        const owningGroup = reorderGroupId;
        // Always tear down the optimistic state before any side effects.
        setReorderGroupId(null);
        setReorderItems({});
        reorderItemsRef.current = {};

        if (event.canceled) return;
        // No change → skip the IPC.
        const sameOrder =
          initialOrder.length === nextOrder.length &&
          initialOrder.every((id, i) => id === nextOrder[i]);
        if (sameOrder) return;

        setMembers.mutate(
          { groupId: owningGroup, orderedPromptIds: nextOrder },
          {
            onError: (err) =>
              pushToast(
                "error",
                `Failed to reorder prompts: ${err.message}`,
              ),
          },
        );
        return;
      }

      if (event.canceled) return;

      // Add-to-group branch — sidebar prompt dropped onto a group target.
      const sourceId = event.operation.source?.id;
      const targetId = event.operation.target?.id;
      if (typeof sourceId !== "string" || typeof targetId !== "string") return;

      let targetGroupId: string | null = null;
      if (targetId.startsWith("group-content:")) {
        targetGroupId = targetId.slice("group-content:".length);
      } else if (targetId.startsWith("group:")) {
        targetGroupId = targetId.slice("group:".length);
      } else {
        return;
      }

      const currentGroupId = promptToGroup.get(sourceId) ?? null;
      if (currentGroupId === targetGroupId) return;

      if (currentGroupId !== null) {
        removeMember.mutate(
          { groupId: currentGroupId, promptId: sourceId },
          {
            onError: (err) =>
              pushToast(
                "error",
                `Failed to remove prompt from previous group: ${err.message}`,
              ),
          },
        );
      }

      addMember.mutate(
        {
          groupId: targetGroupId,
          promptId: sourceId,
          position: BigInt(groupMembers[targetGroupId]?.length ?? 0),
        },
        {
          onError: (err) =>
            pushToast(
              "error",
              `Failed to add prompt to group: ${err.message}`,
            ),
        },
      );
    },
    [
      reorderGroupId,
      groupMembers,
      promptToGroup,
      setMembers,
      addMember,
      removeMember,
      pushToast,
    ],
  );

  const renderRightPane = (): ReactElement => {
    if (selectedPromptId !== null) {
      return (
        <PromptEditorPanel
          promptId={selectedPromptId}
          onClose={() => setSelectedPromptId(null)}
        />
      );
    }
    if (selectedGroupId !== null) {
      const isReorderingThisGroup = reorderGroupId === selectedGroupId;
      const orderOverride = isReorderingThisGroup
        ? (reorderItems[`group-members-${selectedGroupId}`] ?? null)
        : null;
      return (
        <InlineGroupView
          groupId={selectedGroupId}
          onSelectPrompt={(id) => setSelectedPromptId(id)}
          onRenameGroup={(id) => setEditingGroupId(id)}
          onDeleteGroup={handleDeleteGroup}
          orderOverride={orderOverride}
        />
      );
    }
    return (
      <Scrollable
        axis="y"
        className={styles.contentSlot}
        data-testid="prompts-page-content-scroll"
      >
        <PromptsList
          onSelectPrompt={(id) => setSelectedPromptId(id)}
          externallyManagedEditor
        />
      </Scrollable>
    );
  };

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <section className={styles.root} data-testid="prompts-page-root">
        <div className={styles.sidebarSlot}>
          <PromptsSidebar
            selectedPromptId={selectedPromptId}
            selectedGroupId={selectedGroupId}
            onSelectGroup={(groupId) => {
              setSelectedGroupId(groupId);
              setSelectedPromptId(null);
            }}
            onSelectPrompt={(id) => {
              setSelectedPromptId(id);
              setSelectedGroupId(null);
            }}
            onRenameGroup={(id) => setEditingGroupId(id)}
            onDeleteGroup={handleDeleteGroup}
            groupMembers={groupMembers}
          />
        </div>

        <div className={styles.contentSlot}>{renderRightPane()}</div>

        <PromptGroupEditor
          groupId={editingGroupId}
          onClose={() => setEditingGroupId(null)}
        />
      </section>
    </DragDropProvider>
  );
}
