import { useMemo, useState, type ReactElement } from "react";
import { useQueries } from "@tanstack/react-query";

import {
  promptGroupsKeys,
  listPromptGroupMembers,
  useDeletePromptGroupMutation,
  usePromptGroups,
} from "@entities/prompt-group";
import { useToast } from "@app/providers/ToastProvider";
import { Scrollable } from "@shared/ui";
import { PromptsList } from "@widgets/prompts-list";
import { PromptEditor } from "@widgets/prompt-editor";
import { PromptGroupEditor } from "@widgets/prompt-group-editor";
import { PromptsSidebar } from "@widgets/prompts-sidebar";

import styles from "./PromptsPage.module.css";

// ---------------------------------------------------------------------------
// PromptsPage — merged Prompts + Prompt Groups view (round-19c).
// ---------------------------------------------------------------------------

/**
 * Single page replacing the previous /prompts and /prompt-groups routes.
 *
 * Architecture:
 *   - Left rail: `<PromptsSidebar>` (groups on top, prompts of the
 *     active group on the bottom, drag-and-drop wired to the
 *     prompt-group membership IPC).
 *   - Right pane: the existing `<PromptsList>` grid (unchanged
 *     contract). Selecting a prompt in either the rail or the grid
 *     opens the existing `<PromptEditor>` modal.
 *
 * Editor surface decision: PromptEditor stays a modal. The widget is
 * already shaped around `<Dialog>` + open/close transitions; rebuilding
 * it for inline-render would balloon scope and risk breaking its tests.
 * Keeping the modal also matches what the existing PromptsList grid
 * does today, so a prompt picked in the sidebar and a prompt picked in
 * the grid behave identically.
 */
export function PromptsPage(): ReactElement {
  const groupsQuery = usePromptGroups();
  const deleteGroup = useDeletePromptGroupMutation();
  const { pushToast } = useToast();

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);

  // Selection: groupId === null means "All prompts" (ungrouped). The
  // sidebar drives both the active highlight and the prompts shown in
  // the bottom section.
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Fetch the ordered member-id list for every loaded group in parallel.
  // The page owns this fan-out so the sidebar can stay a presentational
  // consumer that doesn't itself fan out N queries.
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

  function handleDeleteGroup(groupId: string): void {
    // No confirm modal here yet — delete fires immediately. UX-wise this
    // mirrors the toast-on-error pattern used elsewhere; a confirm flow
    // is tracked as deferred work.
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

  return (
    <section className={styles.root} data-testid="prompts-page-root">
      <div className={styles.sidebarSlot}>
        <PromptsSidebar
          selectedPromptId={selectedPromptId}
          selectedGroupId={selectedGroupId}
          onSelectGroup={(groupId) => {
            setSelectedGroupId(groupId);
            // Clear prompt selection when switching groups so the editor
            // doesn't keep showing a prompt the user just navigated away from.
            setSelectedPromptId(null);
          }}
          onSelectPrompt={(id) => setSelectedPromptId(id)}
          onRenameGroup={(id) => setEditingGroupId(id)}
          onDeleteGroup={handleDeleteGroup}
          groupMembers={groupMembers}
        />
      </div>

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

      {/*
       * Both editors are mounted at page level so the sidebar selection
       * and the grid selection share one editor instance. Each renders
       * nothing when its id prop is null (RAC handles unmount).
       */}
      <PromptEditor
        promptId={selectedPromptId}
        onClose={() => setSelectedPromptId(null)}
      />

      <PromptGroupEditor
        groupId={editingGroupId}
        onClose={() => setEditingGroupId(null)}
      />
    </section>
  );
}
