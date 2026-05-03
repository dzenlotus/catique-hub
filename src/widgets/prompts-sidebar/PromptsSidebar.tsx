import { useMemo, useState, type ReactElement } from "react";

import {
  SidebarShell,
  SidebarSectionLabel,
  SidebarAddRow,
  SidebarSectionDivider,
} from "@shared/ui";
import { type Prompt, usePrompts } from "@entities/prompt";
import {
  type PromptGroup,
  usePromptGroups,
} from "@entities/prompt-group";
import { PromptGroupCreateDialog } from "@widgets/prompt-group-create-dialog";
import { PromptCreateDialog } from "@widgets/prompt-create-dialog";

import { GroupRow } from "./GroupRow";
import { PromptRow } from "./PromptRow";
import styles from "./PromptsSidebar.module.css";

// ---------------------------------------------------------------------------
// PromptsSidebar — secondary rail for the merged Prompts page.
//
// Round-19d (user-driven restructure):
//   - GROUPS section contains ONLY group rows (no "Prompts" pseudo-entry).
//     The default state — when no group / no prompt is selected — is
//     determined by the parent and renders the grid in the right pane.
//   - PROMPTS section ALWAYS shows every prompt, regardless of which
//     group is currently active. Selecting a group opens that group in
//     the main pane; it no longer filters the sidebar list.
//   - DnD context lives on `<PromptsPage>`. The sidebar contributes
//     draggable rows + group droppables; the membership mutations and
//     the `onDragEnd` handler are owned by the parent so the inline
//     group view (right pane) and the sidebar share one provider.
// ---------------------------------------------------------------------------

export interface PromptsSidebarProps {
  /** Currently-selected prompt id (drives the active highlight). */
  selectedPromptId: string | null;
  /** Currently-selected group id (`null` = "Prompts" / default). */
  selectedGroupId: string | null;
  /** Called when the user picks a group entry from the top section. */
  onSelectGroup: (groupId: string | null) => void;
  /** Called when the user picks a prompt — opens the inline editor. */
  onSelectPrompt: (promptId: string) => void;
  /** Called when the user picks "Rename" on a group's kebab. */
  onRenameGroup: (groupId: string) => void;
  /** Called when the user picks "Delete" on a group's kebab. */
  onDeleteGroup: (groupId: string) => void;
  /**
   * Pre-loaded ordered member ids per group. Currently unused inside
   * the sidebar (the parent uses it to compute `promptToGroup`), but
   * kept on the props contract so callers know where it should flow.
   */
  groupMembers: Record<string, string[]>;
}

export function PromptsSidebar({
  selectedPromptId,
  selectedGroupId,
  onSelectGroup,
  onSelectPrompt,
  onRenameGroup,
  onDeleteGroup,
}: PromptsSidebarProps): ReactElement {
  const promptsQuery = usePrompts();
  const groupsQuery = usePromptGroups();

  const prompts: Prompt[] = useMemo(
    () => promptsQuery.data ?? [],
    [promptsQuery.data],
  );
  const groups: PromptGroup[] = useMemo(
    () => groupsQuery.data ?? [],
    [groupsQuery.data],
  );

  // ── Dialogs ────────────────────────────────────────────────────────
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);

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

    if (groups.length === 0) {
      return (
        <div className={styles.bodyEmpty}>
          <span className={styles.bodyEmptyText}>No groups yet.</span>
        </div>
      );
    }

    return (
      <ul className={styles.groupList} role="list">
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
    if (prompts.length === 0) {
      return (
        <div className={styles.bodyEmpty}>
          <span className={styles.bodyEmptyText}>No prompts yet.</span>
        </div>
      );
    }

    return (
      <ul
        className={styles.promptList}
        role="list"
        data-testid="prompts-sidebar-prompt-list"
      >
        {prompts.map((prompt, index) => (
          <PromptRow
            key={prompt.id}
            prompt={prompt}
            index={index}
            groupId="all"
            isActive={prompt.id === selectedPromptId}
            onSelect={onSelectPrompt}
          />
        ))}
      </ul>
    );
  };

  return (
    <>
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

        <SidebarSectionLabel ariaLabel="Prompts">PROMPTS</SidebarSectionLabel>
        {renderPromptsBody()}
        {promptsQuery.status === "success" ? (
          <SidebarAddRow
            label="Add prompt"
            onPress={() => setIsPromptDialogOpen(true)}
            testId="prompts-sidebar-add-prompt"
          />
        ) : null}
      </SidebarShell>

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
