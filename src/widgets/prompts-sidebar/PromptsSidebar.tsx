import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";

import { cn } from "@shared/lib";
import {
  Button,
  EntityTree,
  IconRenderer,
  KebabIcon,
  MarqueeText,
  Menu,
  MenuItem,
  MenuTrigger,
  SidebarAddRow,
  SidebarNavItem,
  SidebarSectionDivider,
  useEntityTreeExpandedStorage,
} from "@shared/ui";
import type {
  EntityTreeNode,
  EntityTreeRenderRowArgs,
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
// Round-24 (EntityTree unification): the rail consumes the shared
// `<EntityTree>` primitive so row spacing / active-row treatment / chevron
// gutter match the four sibling rails (Roles, Skills, MCP servers, Spaces)
// 1:1. The bespoke `GroupRow` / `PromptRow` components were retired; their
// DnD wiring + kebab menus live inline inside `renderRow` callbacks below.
//
// IA shift (deliberate): groups are now expandable parents whose prompt
// children sit underneath. Prompts not bound to any group land inside an
// "Uncategorised" pseudo-group so every prompt remains reachable from the
// rail. The standalone "All Prompts" entry sits above the tree as a
// header affordance.
//
// DnD contract unchanged: prompt rows expose a `useSortable`-driven drag
// handle with `type: "prompt"`; group rows expose `useDroppable` with id
// `group:<id>`. The orchestrating `<DragDropProvider>` and its drag-end
// handler still live in `PromptsPage`, which routes drops to the
// add/remove-member mutations.
// ---------------------------------------------------------------------------

const UNCATEGORISED_GROUP_ID = "uncategorised";

interface GroupTreeMeta {
  kind: "group";
  group: PromptGroup | null; // `null` for the synthetic Uncategorised parent.
  isUncategorised: boolean;
}

interface PromptTreeMeta {
  kind: "prompt";
  prompt: Prompt;
  /** Sortable bucket id — owning group id or `UNCATEGORISED_GROUP_ID`. */
  groupBucketId: string;
  /** Order inside that bucket (drives `useSortable.index`). */
  index: number;
}

type PromptsTreeMeta = GroupTreeMeta | PromptTreeMeta;

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
   * Used to compute which prompts are uncategorised + to order prompts
   * within their owning groups so the `useSortable` index lines up with
   * the persisted order.
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
  groupMembers,
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
  // prompt children in the tree are restricted to prompts that carry
  // ALL selected tags (intersection). New prompts created via the
  // sidebar's "Add prompt" button inherit the active filter tags so
  // the user lands inside the same filter without an extra click.
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

  // ── Tree shape derivation ─────────────────────────────────────────
  // For each persisted group: collect the prompts whose id appears in
  // `groupMembers[group.id]`, ordered by that list. Anything not bound
  // to a group lands in the synthetic Uncategorised parent so it stays
  // reachable. Filtered-out prompts disappear from their group's
  // children but the group row itself remains (consistent IA across
  // filter states).
  const nodes = useMemo<ReadonlyArray<EntityTreeNode<PromptsTreeMeta>>>(() => {
    const filteredById = new Map<string, Prompt>();
    for (const p of filteredPrompts) filteredById.set(p.id, p);

    const memberOf = new Map<string, string>();
    for (const [gid, ids] of Object.entries(groupMembers)) {
      for (const id of ids) memberOf.set(id, gid);
    }

    function buildPromptChild(
      prompt: Prompt,
      groupBucketId: string,
      index: number,
    ): EntityTreeNode<PromptsTreeMeta> {
      return {
        id: promptNodeId(prompt.id),
        label: prompt.name,
        ...(prompt.icon != null ? { leadingIcon: prompt.icon } : {}),
        ...(prompt.color != null ? { leadingColor: prompt.color } : {}),
        meta: { kind: "prompt", prompt, groupBucketId, index },
      };
    }

    const groupNodes: EntityTreeNode<PromptsTreeMeta>[] = groups.map(
      (group) => {
        const orderedIds = groupMembers[group.id] ?? [];
        const children: EntityTreeNode<PromptsTreeMeta>[] = [];
        let i = 0;
        for (const id of orderedIds) {
          const prompt = filteredById.get(id);
          if (prompt) {
            children.push(buildPromptChild(prompt, group.id, i));
            i += 1;
          }
        }
        return {
          id: groupNodeId(group.id),
          label: group.name,
          ...(group.icon != null ? { leadingIcon: group.icon } : {}),
          ...(group.color != null ? { leadingColor: group.color } : {}),
          children,
          meta: { kind: "group", group, isUncategorised: false },
        };
      },
    );

    const uncategorised = filteredPrompts.filter(
      (p) => !memberOf.has(p.id),
    );
    if (uncategorised.length > 0) {
      groupNodes.push({
        id: groupNodeId(UNCATEGORISED_GROUP_ID),
        label: "Uncategorised",
        children: uncategorised.map((p, idx) =>
          buildPromptChild(p, UNCATEGORISED_GROUP_ID, idx),
        ),
        meta: { kind: "group", group: null, isUncategorised: true },
      });
    }

    return groupNodes;
  }, [groups, groupMembers, filteredPrompts]);

  // ── Persisted expansion state ──────────────────────────────────────
  // `useEntityTreeExpandedStorage` stores the open group ids as a JSON
  // array under one key — superseding the old per-group boolean keys
  // (`catique:sidebar:expanded:<groupId>`). Old keys are stale; that's
  // acceptable per the personal-tool ethos called out in the migration
  // brief.
  const { expandedIds, toggleExpand } = useEntityTreeExpandedStorage(
    "catique:sidebar:expanded:prompt-groups",
  );

  // ── Dialogs ────────────────────────────────────────────────────────
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);

  // ── Selection mapping ──────────────────────────────────────────────
  // EntityTree's `selectedId` is a single namespaced id; we project the
  // page's two-axis selection (group/prompt) onto it. A selected prompt
  // wins over a selected group so the leaf row carries the highlight
  // when both are technically active.
  const selectedTreeId: string | null = selectedPromptId !== null
    ? promptNodeId(selectedPromptId)
    : selectedGroupId !== null
      ? groupNodeId(selectedGroupId)
      : null;

  const handleSelect = useCallback(
    (id: string, node: EntityTreeNode<PromptsTreeMeta>): void => {
      const meta = node.meta;
      if (!meta) return;
      if (meta.kind === "prompt") {
        onSelectPrompt(meta.prompt.id);
        return;
      }
      // Group row click — synthetic "Uncategorised" parent isn't a real
      // group and has no settings page to land on, so swallow its click.
      if (meta.isUncategorised) {
        toggleExpand(id);
        return;
      }
      if (meta.group !== null) onSelectGroup(meta.group.id);
    },
    [onSelectPrompt, onSelectGroup, toggleExpand],
  );

  // ── renderRow — kebab + DnD live inside the row body. ─────────────
  const renderRow = useCallback(
    (args: EntityTreeRenderRowArgs<PromptsTreeMeta>): ReactNode => {
      const meta = args.node.meta;
      if (!meta) return null;
      if (meta.kind === "group") {
        return (
          <GroupRowBody
            args={args}
            meta={meta}
            onRename={onRenameGroup}
            onSettings={onGroupSettings}
            onDelete={onDeleteGroup}
          />
        );
      }
      return <PromptRowBody args={args} meta={meta} />;
    },
    [onRenameGroup, onGroupSettings, onDeleteGroup],
  );

  const isAllPromptsActive =
    selectedGroupId === null && selectedPromptId === null;

  return (
    <>
      <EntityTree<PromptsTreeMeta>
        title="PROMPTS"
        ariaLabel="Prompts navigation"
        nodes={nodes}
        selectedId={selectedTreeId}
        expandedIds={expandedIds}
        onToggleExpand={toggleExpand}
        onSelect={handleSelect}
        addLabel="Add prompt"
        onAdd={() => setIsPromptDialogOpen(true)}
        emptyText="No prompts yet."
        isLoading={
          promptsQuery.status === "pending" || groupsQuery.status === "pending"
        }
        errorMessage={
          promptsQuery.status === "error"
            ? `Failed to load prompts: ${promptsQuery.error.message}`
            : groupsQuery.status === "error"
              ? `Failed to load groups: ${groupsQuery.error.message}`
              : null
        }
        testIdPrefix="prompts-sidebar"
        renderRow={renderRow}
        titleTrailingNode={
          <span className={styles.sectionLabelActions}>
            <TagsFilterButton
              selectedTagIds={filterTagIds}
              onChange={setFilterTagIds}
            />
            <PromptsSettingsButton onPress={onOpenSettings} />
          </span>
        }
        headerNode={
          <>
            <SidebarNavItem
              isActive={isAllPromptsActive}
              onClick={() => onSelectGroup(null)}
              ariaLabel="All Prompts"
              testId="prompts-sidebar-all-prompts"
            >
              All Prompts
            </SidebarNavItem>
            <SidebarSectionDivider />
          </>
        }
        footerNode={
          groupsQuery.status === "success" ? (
            <SidebarAddRow
              label="Add group"
              ariaLabel="Add group"
              onPress={() => setIsGroupDialogOpen(true)}
              testId="prompts-sidebar-add-group"
            />
          ) : null
        }
      />

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
// Row bodies — kept inside this module so the `renderRow` callback stays
// composable. Each body owns its DnD hook (one hook call per node) and
// renders the EntityTree-style label button + an inline kebab.
// ─────────────────────────────────────────────────────────────────────────────

interface GroupRowBodyProps {
  args: EntityTreeRenderRowArgs<PromptsTreeMeta>;
  meta: GroupTreeMeta;
  onRename: (id: string) => void;
  onSettings: (id: string) => void;
  onDelete: (id: string) => void;
}

function GroupRowBody({
  args,
  meta,
  onRename,
  onSettings,
  onDelete,
}: GroupRowBodyProps): ReactElement {
  const group = meta.group;
  const { node, select } = args;

  // Synthetic "Uncategorised" parent isn't a real DB row — no droppable
  // wiring (the dnd-kit handler in PromptsPage has no remove-from-group
  // mutation for that target id) and no kebab.
  return meta.isUncategorised || group === null ? (
    <UncategorisedGroupBody node={node} />
  ) : (
    <RealGroupBody
      group={group}
      node={node}
      select={select}
      onRename={onRename}
      onSettings={onSettings}
      onDelete={onDelete}
    />
  );
}

interface RealGroupBodyProps {
  group: PromptGroup;
  node: EntityTreeNode<PromptsTreeMeta>;
  select: () => void;
  onRename: (id: string) => void;
  onSettings: (id: string) => void;
  onDelete: (id: string) => void;
}

function RealGroupBody({
  group,
  node,
  select,
  onRename,
  onSettings,
  onDelete,
}: RealGroupBodyProps): ReactElement {
  // Drop target for the cross-group "add to group" gesture. The id is
  // `group:<id>` so PromptsPage's `handleDragEnd` can route to the
  // addMember/removeMember mutation pair.
  const { ref, isDropTarget } = useDroppable({
    id: `group:${group.id}`,
    type: "group",
    accept: ["prompt"],
  });

  return (
    <div
      ref={(el) => ref(el)}
      className={styles.rowDroppable}
      data-drop-target={isDropTarget ? "true" : undefined}
      data-testid={`prompts-sidebar-group-droppable-${group.id}`}
    >
      <button
        type="button"
        className={styles.rowButton}
        onClick={select}
        aria-label={node.label}
        data-testid={`prompts-sidebar-row-${node.id}`}
      >
        <RowLeading node={node} />
        <MarqueeText text={node.label} className={styles.label} />
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

interface UncategorisedGroupBodyProps {
  node: EntityTreeNode<PromptsTreeMeta>;
}

function UncategorisedGroupBody({
  node,
}: UncategorisedGroupBodyProps): ReactElement {
  return (
    <span
      className={cn(styles.rowButton, styles.uncategorisedLabel)}
      data-testid={`prompts-sidebar-row-${node.id}`}
    >
      <MarqueeText text={node.label} className={styles.label} />
    </span>
  );
}

interface PromptRowBodyProps {
  args: EntityTreeRenderRowArgs<PromptsTreeMeta>;
  meta: PromptTreeMeta;
}

function PromptRowBody({ args, meta }: PromptRowBodyProps): ReactElement {
  const { node, select } = args;
  const { prompt, groupBucketId, index } = meta;
  const { ref, handleRef, isDragging } = useSortable({
    id: prompt.id,
    index,
    group: groupBucketId,
    type: "prompt",
    accept: ["prompt"],
  });

  return (
    <div
      ref={(el) => ref(el)}
      className={cn(styles.rowDraggable, isDragging && styles.rowDragging)}
      data-testid={`prompts-sidebar-prompt-draggable-${prompt.id}`}
    >
      <button
        type="button"
        ref={(el) => handleRef(el)}
        className={styles.dragHandle}
        aria-label={`Drag prompt ${prompt.name}`}
        data-testid={`prompts-sidebar-prompt-handle-${prompt.id}`}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <button
        type="button"
        className={styles.rowButton}
        onClick={select}
        aria-label={node.label}
        data-testid={`prompts-sidebar-row-${node.id}`}
      >
        <RowLeading node={node} />
        <MarqueeText text={node.label} className={styles.label} />
      </button>
    </div>
  );
}

interface RowLeadingProps {
  node: EntityTreeNode<PromptsTreeMeta>;
}

function RowLeading({ node }: RowLeadingProps): ReactElement | null {
  if (node.leadingIcon !== undefined) {
    return (
      <IconRenderer
        name={node.leadingIcon}
        width={14}
        height={14}
        className={styles.icon}
        {...(node.leadingColor != null
          ? { style: { color: node.leadingColor } }
          : {})}
      />
    );
  }
  if (node.leadingColor != null) {
    return (
      <span
        className={styles.swatch}
        style={{ backgroundColor: node.leadingColor }}
        aria-hidden="true"
      />
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree-id namespacing — keeps groups + prompts coexisting under one
// EntityTree without id collisions. The active highlight selects exactly
// one row regardless of which axis (group or prompt) is current.
// ─────────────────────────────────────────────────────────────────────────────

function groupNodeId(groupId: string): string {
  return `group:${groupId}`;
}

function promptNodeId(promptId: string): string {
  return `prompt:${promptId}`;
}
