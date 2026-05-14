import { useMemo, useState, type ReactElement } from "react";
import { useDroppable } from "@dnd-kit/react";

import {
  Button,
  KebabIcon,
  MarqueeText,
  Menu,
  MenuItem,
  MenuTrigger,
  RailSection,
  Row,
  RowLeading,
  SidebarNavItem,
  SidebarSectionDivider,
  SidebarShell,
} from "@shared/ui";
import { type Prompt, usePrompts, usePromptTagsMap } from "@entities/prompt";
import {
  type PromptGroup,
  usePromptGroups,
} from "@entities/prompt-group";
import { PromptGroupCreateDialog } from "@widgets/prompt-group-create-dialog";
import { PromptCreateDialog } from "@widgets/prompt-create-dialog";

import { PromptsSettingsButton } from "./PromptsSettingsButton";
import { TagsFilterButton } from "./TagsFilterButton";
import styles from "./PromptsSidebar.module.css";

// ---------------------------------------------------------------------------
// PromptsSidebar — secondary rail for the merged Prompts page.
//
// IA (round-26, post Row/Group split): two flat sections inside ONE rail.
//   - "All Prompts" entry sits at the top of the shell as the default
//     landing for the right pane.
//   - GROUPS section — flat list of `<Row>`s; each row body wraps a
//     `useDroppable` container (`group:<id>`) so prompts can be
//     dragged into it. The row body also hosts the kebab menu.
//   - PROMPTS section — flat list of `<Row isDraggable>` registering
//     each prompt as a sortable source whose id is the BARE prompt
//     id. PromptsPage's drag-end handler routes drops against
//     `promptToGroup.get(rawId)`.
//
// DnD provider lives in `PromptsPage` so the sidebar's draggable rows
// and the inline group view share one context. The primitive contributes
// only `useSortable` (prompts, via `<Row isDraggable>`) + `useDroppable`
// (groups, inside the row body).
// ---------------------------------------------------------------------------

export interface PromptsSidebarProps {
  /** Currently-selected prompt id (drives the active highlight). */
  selectedPromptId: string | null;
  /** Currently-selected group id (`null` = "All Prompts" / default). */
  selectedGroupId: string | null;
  /** Called when the user picks a group entry. */
  onSelectGroup: (groupId: string | null) => void;
  /** Called when the user picks a prompt — opens the inline editor. */
  onSelectPrompt: (promptId: string) => void;
  /** Called when the user picks "Rename" on a group's kebab. */
  onRenameGroup: (groupId: string) => void;
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
  onRenameGroup,
  onGroupSettings,
  onDeleteGroup,
  onOpenSettings,
}: PromptsSidebarProps): ReactElement {
  const promptsQuery = usePrompts();
  const groupsQuery = usePromptGroups();
  const tagsMapQuery = usePromptTagsMap();

  const prompts: ReadonlyArray<Prompt> = useMemo(
    () => promptsQuery.data ?? [],
    [promptsQuery.data],
  );
  const groups: ReadonlyArray<PromptGroup> = useMemo(
    () => groupsQuery.data ?? [],
    [groupsQuery.data],
  );

  // ── Filter state ───────────────────────────────────────────────────
  // Multi-select tag filter — when one or more tags are selected, the
  // PROMPTS list is restricted to prompts that carry ALL selected tags
  // (intersection). New prompts created via the sidebar's "Add prompt"
  // button inherit the active filter tags so the user lands inside the
  // same filter without an extra click.
  const [filterTagIds, setFilterTagIds] = useState<ReadonlyArray<string>>([]);

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

  const isAllPromptsActive =
    selectedGroupId === null && selectedPromptId === null;

  const activeGroupSelectionId =
    selectedPromptId === null ? selectedGroupId : null;

  return (
    <>
      <SidebarShell ariaLabel="Prompts navigation" testId="prompts-sidebar-root">
        {/* Default landing — sits above any section label. */}
        <SidebarNavItem
          isActive={isAllPromptsActive}
          onClick={() => onSelectGroup(null)}
          ariaLabel="All Prompts"
          testId="prompts-sidebar-all-prompts"
        >
          All Prompts
        </SidebarNavItem>

        <SidebarSectionDivider />

        <RailSection
          title="GROUPS"
          titleAriaLabel="Groups"
          testIdPrefix="prompts-sidebar-groups"
          addLabel="Add group"
          onAdd={() => setIsGroupDialogOpen(true)}
          emptyText="No groups yet."
          isLoading={groupsQuery.status === "pending"}
          errorMessage={
            groupsQuery.status === "error"
              ? `Failed to load groups: ${groupsQuery.error.message}`
              : null
          }
          isEmpty={groups.length === 0}
        >
          {groups.map((group) => (
            <Row
              key={group.id}
              testId={`prompts-sidebar-groups-item-${group.id}`}
              isActive={activeGroupSelectionId === group.id}
              onClick={() => onSelectGroup(group.id)}
              renderContent={() => (
                <GroupRowBody
                  group={group}
                  onSelect={() => onSelectGroup(group.id)}
                  onRename={onRenameGroup}
                  onSettings={onGroupSettings}
                  onDelete={onDeleteGroup}
                />
              )}
            />
          ))}
        </RailSection>

        <SidebarSectionDivider />

        <RailSection
          title="PROMPTS"
          titleAriaLabel="Prompts"
          testIdPrefix="prompts-sidebar-prompts"
          addLabel="Add prompt"
          onAdd={() => setIsPromptDialogOpen(true)}
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
          isEmpty={filteredPrompts.length === 0}
          titleTrailingNode={
            <span className={styles.sectionLabelActions}>
              <TagsFilterButton
                selectedTagIds={filterTagIds}
                onChange={setFilterTagIds}
              />
              <PromptsSettingsButton onPress={onOpenSettings} />
            </span>
          }
        >
          {filteredPrompts.map((prompt, index) => (
            <Row
              key={prompt.id}
              testId={`prompts-sidebar-prompts-item-${prompt.id}`}
              isActive={selectedPromptId === prompt.id}
              isDraggable
              // BARE prompt id — PromptsPage's drag-end handler routes
              // drops via `promptToGroup.get(rawId)` without stripping
              // any prefix. See `<PromptsPage>` for the contract.
              sortableId={prompt.id}
              sortableType="prompt"
              sortableGroup="all"
              sortableAccept={["prompt"]}
              sortableIndex={index}
              onClick={() => onSelectPrompt(prompt.id)}
              dragHandleAriaLabel={`Drag ${prompt.name}`}
              dragHandleTestId={`prompts-sidebar-prompts-handle-${prompt.id}`}
              renderContent={() => (
                <PromptRowBody
                  prompt={prompt}
                  onSelect={() => onSelectPrompt(prompt.id)}
                />
              )}
            />
          ))}
        </RailSection>
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
// Row bodies — kept inside this module so each `renderContent` callback
// can own its single DnD hook. `<Row>` provides the hover/active
// background; these bodies just supply the click target + kebab.
// ─────────────────────────────────────────────────────────────────────────────

interface GroupRowBodyProps {
  group: PromptGroup;
  onSelect: () => void;
  onRename: (id: string) => void;
  onSettings: (id: string) => void;
  onDelete: (id: string) => void;
}

function GroupRowBody({
  group,
  onSelect,
  onRename,
  onSettings,
  onDelete,
}: GroupRowBodyProps): ReactElement {
  // Drop target for the cross-group "add to group" gesture. The id is
  // `group:<id>` so PromptsPage's drag-end handler can route to the
  // addMember / removeMember mutation pair.
  const { ref, isDropTarget } = useDroppable({
    id: `group:${group.id}`,
    type: "group",
    accept: ["prompt"],
  });

  return (
    <div
      ref={ref}
      className={styles.rowDroppable}
      data-drop-target={isDropTarget ? "true" : undefined}
      data-testid={`prompts-sidebar-group-droppable-${group.id}`}
    >
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
      <MenuTrigger>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Actions for group ${group.name}`}
          data-testid={`prompts-sidebar-group-kebab-${group.id}`}
        >
          <KebabIcon />
        </Button>
        <Menu
          onAction={(key) => {
            if (key === "rename") onRename(group.id);
            else if (key === "settings") onSettings(group.id);
            else if (key === "delete") onDelete(group.id);
          }}
        >
          <MenuItem id="rename">Rename</MenuItem>
          <MenuItem id="settings">Settings</MenuItem>
          <MenuItem id="delete">Delete</MenuItem>
        </Menu>
      </MenuTrigger>
    </div>
  );
}

interface PromptRowBodyProps {
  prompt: Prompt;
  onSelect: () => void;
}

function PromptRowBody({ prompt, onSelect }: PromptRowBodyProps): ReactElement {
  // `<Row>` owns the drag handle + sortable wiring. This body just
  // renders the label-button; the primitive sandwiches it with the
  // handle on the left when `isDraggable` is set on the row.
  return (
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
  );
}
