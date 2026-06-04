import { useCallback, useMemo, useState, type ReactElement } from "react";

import {
  EntityActionMenu,
  EntityTree,
  type EntityTreeNode,
  Input,
  MarqueeText,
  RowLeading,
  SidebarSectionDivider,
  SidebarShell,
} from "@shared/ui";
import { SidebarSectionAddTrigger } from "@shared/ui/SidebarShell";
import { usePromptTagFilter, useToast } from "@shared/lib";
import { type Prompt, usePrompts, usePromptTagsMap } from "@entities/prompt";
import {
  type PromptGroup,
  usePromptGroups,
  useUpdatePromptGroupMutation,
} from "@entities/prompt-group";
import { PromptGroupCreateDialog } from "@features/prompt-group/create-dialog";
import { PromptCreateDialog } from "@features/prompt/create-dialog";

import { PromptsSettingsButton } from "./PromptsSettingsButton";
import { PromptsTagFilterPopover } from "./PromptsTagFilterPopover";
import styles from "./PromptsSidebar.module.css";

// ---------------------------------------------------------------------------
// PromptsSidebar — secondary rail for the merged Prompts page.
//
// Two flat `<EntityTree/>` sections inside one `<SidebarShell>`:
//   1. GROUPS — droppable rows (`useDroppable` per row via
//      `rowConfig.droppable`) so prompts can be dragged into them.
//   2. PROMPTS — draggable rows (`useSortable` per row via
//      `rowConfig.draggable`) registering with the bare prompt id; the
//      drag-end handler in `PromptsPage` routes against the active
//      `promptToGroup` map.
//
// DnD provider (`<DragDropProvider>`) lives in `PromptsPage` so the
// sidebar's draggables and the inline group view share one context.
// `<EntityTree/>` just declares which rows are droppable / sortable;
// each row's body comes through `renderRow`.
// ---------------------------------------------------------------------------

export interface PromptsSidebarProps {
  /** Currently-selected prompt id (drives the active highlight). */
  selectedPromptId: string | null;
  /** Currently-selected group id (`null` = nothing selected / default). */
  selectedGroupId: string | null;
  /** Called when the user picks a group entry. */
  onSelectGroup: (groupId: string | null) => void;
  /** Called when the user picks a prompt — opens the inline editor. */
  onSelectPrompt: (promptId: string) => void;
  /** Called when the user picks "Settings" on a group's kebab. */
  onGroupSettings: (groupId: string) => void;
  /** Called when the user picks "Delete" on a group's kebab. */
  onDeleteGroup: (groupId: string) => void;
  /** Called when the user picks the settings cog in the section header. */
  onOpenSettings: () => void;
  /**
   * Pre-loaded ordered member ids per group, threaded from `PromptsPage`.
   * The sidebar itself does not consume this directly; it's part of the
   * prop contract because `PromptsPage`'s drag-end handler needs the
   * latest server state.
   */
  groupMembers: Record<string, string[]>;
}

export function PromptsSidebar({
  selectedPromptId,
  selectedGroupId,
  onSelectGroup,
  onSelectPrompt,
  onGroupSettings,
  onDeleteGroup,
  onOpenSettings,
}: PromptsSidebarProps): ReactElement {
  const promptsQuery = usePrompts();
  const groupsQuery = usePromptGroups();
  const tagsMapQuery = usePromptTagsMap();
  const updateGroup = useUpdatePromptGroupMutation();
  const { pushToast } = useToast();

  // ── Inline group rename (round-26) ─────────────────────────────────
  // Replaces the old `PromptGroupEditor` modal. The kebab "Rename" item
  // swaps the group row's label into a shared `<Input labelHidden>` that
  // commits on Enter / blur and cancels on Escape.
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);

  const commitRename = useCallback(
    (groupId: string, nextName: string): void => {
      const trimmed = nextName.trim();
      const current = groupsQuery.data?.find((g) => g.id === groupId);
      if (trimmed.length === 0 || trimmed === current?.name) {
        setRenamingGroupId(null);
        return;
      }
      updateGroup.mutate(
        { id: groupId, name: trimmed },
        {
          onSuccess: () => setRenamingGroupId(null),
          onError: (err) => {
            pushToast("error", `Failed to rename group: ${err.message}`);
            setRenamingGroupId(null);
          },
        },
      );
    },
    [groupsQuery.data, updateGroup, pushToast],
  );

  const cancelRename = useCallback((): void => {
    setRenamingGroupId(null);
  }, []);

  const prompts: ReadonlyArray<Prompt> = useMemo(
    () => promptsQuery.data ?? [],
    [promptsQuery.data],
  );
  const groups: ReadonlyArray<PromptGroup> = useMemo(
    () => groupsQuery.data ?? [],
    [groupsQuery.data],
  );

  // ── Filter state ───────────────────────────────────────────────────
  // The tag-filter control now lives in the global header (TopBar). The
  // selected ids are shared through the `usePromptTagFilter` store so the
  // sidebar list reacts without the control living here.
  const { selectedTagIds: filterTagIds } = usePromptTagFilter();

  const filteredPrompts = useMemo<ReadonlyArray<Prompt>>(() => {
    if (filterTagIds.length === 0) return prompts;
    const promptTags = tagsMapQuery.data;
    if (!promptTags) return prompts;
    const promptToTagSet = new Map<string, Set<string>>();
    for (const entry of promptTags) {
      promptToTagSet.set(entry.promptId, new Set(entry.tagIds));
    }
    return prompts.filter((p) => {
      const tagSet = promptToTagSet.get(p.id);
      if (!tagSet) return false;
      return filterTagIds.every((id) => tagSet.has(id));
    });
  }, [prompts, filterTagIds, tagsMapQuery.data]);

  // ── Dialogs ────────────────────────────────────────────────────────
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);

  const activeGroupSelectionId =
    selectedPromptId === null ? selectedGroupId : null;

  // ── Tree data ──────────────────────────────────────────────────────
  const groupsTreeData = useMemo<EntityTreeNode<PromptGroup>[]>(
    () =>
      groups.map((group) => ({
        id: group.id,
        label: group.name,
        data: group,
      })),
    [groups],
  );

  const promptsTreeData = useMemo<EntityTreeNode<Prompt>[]>(
    () =>
      filteredPrompts.map((prompt) => ({
        id: prompt.id,
        label: prompt.name,
        data: prompt,
      })),
    [filteredPrompts],
  );

  return (
    <>
      <SidebarShell ariaLabel="Prompts navigation" testId="prompts-sidebar-root">
        <EntityTree<PromptGroup>
          testIdPrefix="prompts-sidebar-groups"
          title="GROUPS"
          titleAriaLabel="Groups"
          titleTrailingNode={
            groupsQuery.status === "success" ? (
              <SidebarSectionAddTrigger
                ariaLabel="Add group"
                onPress={() => setIsGroupDialogOpen(true)}
                testId="prompts-sidebar-groups-add"
              />
            ) : null
          }
          emptyText="No groups yet."
          isLoading={groupsQuery.status === "pending"}
          errorMessage={
            groupsQuery.status === "error"
              ? `Failed to load groups: ${groupsQuery.error.message}`
              : null
          }
          data={groupsTreeData}
          rowConfig={(node) => ({
            isActive: activeGroupSelectionId === node.id,
            onClick: () => onSelectGroup(node.id),
            // `group:<id>` is the droppable id the PromptsPage drag-end
            // handler routes on — see `PromptsPage`'s comment for the
            // contract.
            droppable: {
              id: `group:${node.id}`,
              type: "group",
              accept: ["prompt"],
            },
          })}
          renderRow={({ node }) => {
            const group = node.data;
            if (!group) return null;
            return (
              <GroupRowBody
                group={group}
                isRenaming={renamingGroupId === group.id}
                onSelect={() => onSelectGroup(group.id)}
                onBeginRename={() => setRenamingGroupId(group.id)}
                onCommitRename={(next) => commitRename(group.id, next)}
                onCancelRename={cancelRename}
                onSettings={onGroupSettings}
                onDelete={onDeleteGroup}
              />
            );
          }}
        />

        <SidebarSectionDivider />

        <EntityTree<Prompt>
          testIdPrefix="prompts-sidebar-prompts"
          title="PROMPTS"
          titleAriaLabel="Prompts"
          emptyText={
            prompts.length === 0
              ? "No prompts yet."
              : "No prompts match the active tag filter."
          }
          isLoading={promptsQuery.status === "pending"}
          errorMessage={
            promptsQuery.status === "error"
              ? `Failed to load prompts: ${promptsQuery.error.message}`
              : null
          }
          titleTrailingNode={
            <span className={styles.sectionLabelActions}>
              <PromptsTagFilterPopover />
              <PromptsSettingsButton onPress={onOpenSettings} />
              {promptsQuery.status === "success" ? (
                <SidebarSectionAddTrigger
                  ariaLabel="Add prompt"
                  onPress={() => setIsPromptDialogOpen(true)}
                  testId="prompts-sidebar-prompts-add"
                />
              ) : null}
            </span>
          }
          data={promptsTreeData}
          rowConfig={(node) => ({
            isActive: selectedPromptId === node.id,
            onClick: () => onSelectPrompt(node.id),
            draggable: {
              type: "prompt",
              group: "all",
              handleAriaLabel: `Drag ${node.label}`,
            },
          })}
          renderRow={({ node }) => {
            const prompt = node.data;
            if (!prompt) return null;
            return (
              <PromptRowBody
                prompt={prompt}
                onSelect={() => onSelectPrompt(prompt.id)}
              />
            );
          }}
        />
      </SidebarShell>

      <PromptGroupCreateDialog
        isOpen={isGroupDialogOpen}
        onClose={() => setIsGroupDialogOpen(false)}
        onCreated={(group) => onSelectGroup(group.id)}
      />

      <PromptCreateDialog
        isOpen={isPromptDialogOpen}
        onClose={() => setIsPromptDialogOpen(false)}
        inheritedTagIds={filterTagIds}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row bodies — separate components so each owns its kebab MenuTrigger
// without forcing `<EntityTree/>` to learn about per-row actions.
// ─────────────────────────────────────────────────────────────────────────────

interface GroupRowBodyProps {
  group: PromptGroup;
  /** When true, the label row is replaced by the inline rename input. */
  isRenaming: boolean;
  onSelect: () => void;
  /** Enter inline rename mode (kebab "Rename"). */
  onBeginRename: () => void;
  /** Commit the new name (Enter / blur). */
  onCommitRename: (nextName: string) => void;
  /** Abort the rename (Escape). */
  onCancelRename: () => void;
  onSettings: (id: string) => void;
  onDelete: (id: string) => void;
}

function GroupRowBody({
  group,
  isRenaming,
  onSelect,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onSettings,
  onDelete,
}: GroupRowBodyProps): ReactElement {
  if (isRenaming) {
    return (
      <div className={styles.rowBody}>
        <GroupRenameInput
          group={group}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      </div>
    );
  }

  return (
    <div className={styles.rowBody}>
      <button
        type="button"
        className={styles.rowButton}
        onClick={onSelect}
        aria-label={group.name}
        data-testid={`prompts-sidebar-groups-row-${group.id}`}
      >
        <RowLeading icon={group.icon} color={group.color} />
        <MarqueeText text={group.name} className={styles.label} />
      </button>
      <EntityActionMenu
        items={[
          { id: "rename", label: "Rename", onAction: onBeginRename },
          { id: "settings", label: "Settings", onAction: () => onSettings(group.id) },
          { id: "delete", label: "Delete", onAction: () => onDelete(group.id) },
        ]}
        triggerAriaLabel={`Actions for group ${group.name}`}
        triggerTestId={`prompts-sidebar-group-kebab-${group.id}`}
        triggerClassName={styles.groupKebab}
      />
    </div>
  );
}

interface GroupRenameInputProps {
  group: PromptGroup;
  onCommit: (nextName: string) => void;
  onCancel: () => void;
}

function GroupRenameInput({
  group,
  onCommit,
  onCancel,
}: GroupRenameInputProps): ReactElement {
  const [draft, setDraft] = useState(group.name);

  return (
    <Input
      type="text"
      label={`Rename group ${group.name}`}
      labelHidden
      className={styles.renameField}
      value={draft}
      onChange={setDraft}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      autoFocus
      data-testid={`prompts-sidebar-group-rename-input-${group.id}`}
    />
  );
}

interface PromptRowBodyProps {
  prompt: Prompt;
  onSelect: () => void;
}

function PromptRowBody({ prompt, onSelect }: PromptRowBodyProps): ReactElement {
  return (
    <div className={styles.rowBody}>
      <button
        type="button"
        className={styles.rowButton}
        onClick={onSelect}
        aria-label={prompt.name}
        data-testid={`prompts-sidebar-prompts-row-${prompt.id}`}
      >
        <RowLeading icon={prompt.icon} color={prompt.color} />
        <MarqueeText text={prompt.name} className={styles.label} />
      </button>
    </div>
  );
}
