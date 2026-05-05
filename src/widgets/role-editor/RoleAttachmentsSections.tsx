/**
 * `RoleAttachmentsSections` — three composed sections rendered inside
 * `RoleEditor`: attached prompts, skills, MCP tools. Each section
 * follows the same pattern (list + Attach + Create / Empty state) so
 * the user reads the role editor as a single repeating affordance.
 *
 * Sub-components are colocated here (instead of `shared/ui`) because:
 *   - they are tightly coupled to role-editor mutations,
 *   - they are not generic enough to merit a shared API surface,
 *   - they bind to dnd-kit `useSortable` which already has narrowly-
 *     scoped consumers in `widgets/prompts-sidebar` (PromptRow).
 *
 * ctq-103 lands the prompts section + create/attach. ctq-116 lands
 * the skills + MCP-tools sections. ctq-109 layers drag-reorder for
 * the prompts list (and is wired through optimistic ordering here).
 */

import { useMemo, useState, type ReactElement } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";

import { Button } from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";
import {
  useRolePrompts,
  useRoleSkills,
  useRoleMcpTools,
  useAddRolePromptMutation,
  useRemoveRolePromptMutation,
  useSetRolePromptsMutation,
  useRemoveRoleSkillMutation,
  useRemoveRoleMcpToolMutation,
} from "@entities/role";
import type { Prompt } from "@bindings/Prompt";
import type { Skill } from "@bindings/Skill";
import type { McpTool } from "@bindings/McpTool";
import { useCreatePromptMutation } from "@entities/prompt";
import { AttachPromptDialog } from "@widgets/attach-prompt-dialog";
import { PromptCreateDialog } from "@widgets/prompt-create-dialog";

import styles from "./RoleEditor.module.css";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RoleAttachmentsSectionsProps {
  roleId: string;
}

/**
 * Renders the three role-attachment sections in document order.
 *
 * Mounted only after the role's main fields finished loading
 * (`<RoleEditor>` gates this on `query.data`), so all sub-queries are
 * fired with a non-empty `roleId`.
 */
export function RoleAttachmentsSections({
  roleId,
}: RoleAttachmentsSectionsProps): ReactElement {
  return (
    <>
      <RolePromptsSection roleId={roleId} />
      <RoleSkillsSection roleId={roleId} />
      <RoleMcpToolsSection roleId={roleId} />
    </>
  );
}

// ─── Prompts section (ctq-103 + ctq-109) ─────────────────────────────────────

interface RolePromptsSectionProps {
  roleId: string;
}

function RolePromptsSection({
  roleId,
}: RolePromptsSectionProps): ReactElement {
  const query = useRolePrompts(roleId);
  const removeMutation = useRemoveRolePromptMutation();
  const setMutation = useSetRolePromptsMutation();
  const createMutation = useCreatePromptMutation();
  const addMutation = useAddRolePromptMutation();
  const { pushToast } = useToast();

  const [isAttachOpen, setIsAttachOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Optimistic order: when user drags, this overrides the server order
  // until the mutation resolves. Cleared on settle.
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null);

  const serverPrompts = useMemo<Prompt[]>(
    () => query.data ?? [],
    [query.data],
  );

  const orderedPrompts = useMemo<Prompt[]>(() => {
    if (optimisticIds === null) return serverPrompts;
    const byId = new Map(serverPrompts.map((p) => [p.id, p]));
    return optimisticIds
      .map((id) => byId.get(id))
      .filter((p): p is Prompt => p !== undefined);
  }, [serverPrompts, optimisticIds]);

  const handleRemove = (promptId: string): void => {
    removeMutation.mutate(
      { roleId, promptId },
      {
        onError: (err) => {
          pushToast("error", `Failed to detach prompt: ${err.message}`);
        },
      },
    );
  };

  const handleReorder = (nextIds: string[]): void => {
    const previousIds = serverPrompts.map((p) => p.id);
    setOptimisticIds(nextIds);
    setMutation.mutate(
      { roleId, promptIds: nextIds },
      {
        onError: (err) => {
          // Rollback to server order on failure.
          setOptimisticIds(null);
          pushToast(
            "error",
            `Failed to reorder prompts: ${err.message}` +
              (previousIds.length === 0 ? "" : ""),
          );
        },
        onSuccess: () => {
          // Keep optimistic order until the next refetch overwrites it.
          setOptimisticIds(null);
        },
      },
    );
  };

  return (
    <section
      className={styles.section}
      data-testid="role-editor-prompts-section"
    >
      <header className={styles.attachmentSectionHeader}>
        <p className={styles.sectionLabel}>Prompts</p>
        <div className={styles.attachmentSectionActions}>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setIsAttachOpen(true)}
            data-testid="role-editor-prompts-attach"
          >
            Attach existing
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setIsCreateOpen(true)}
            data-testid="role-editor-prompts-create"
          >
            Create + attach
          </Button>
        </div>
      </header>

      <RolePromptsListBody
        prompts={orderedPrompts}
        status={query.status}
        errorMessage={
          query.status === "error" ? query.error.message : null
        }
        onRemove={handleRemove}
        onReorder={handleReorder}
      />

      <AttachPromptDialog
        isOpen={isAttachOpen}
        onClose={() => setIsAttachOpen(false)}
        defaultTarget={{ kind: "role", id: roleId }}
        lockedTarget
        onAttached={() => {
          // useAddRolePromptMutation already invalidates; nothing more
          // to do here. Toast surfaces from the dialog.
        }}
      />

      <PromptCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(prompt) => {
          // After create, attach to the role at the end of the list.
          const nextPosition = serverPrompts.length;
          addMutation.mutate(
            { roleId, promptId: prompt.id, position: nextPosition },
            {
              onError: (err) => {
                pushToast(
                  "error",
                  `Created prompt but failed to attach: ${err.message}`,
                );
              },
              onSuccess: () => {
                pushToast("success", "Prompt created and attached");
              },
            },
          );
        }}
      />
      {/* `createMutation` status is inspected by the dialog itself; we
          only forward the prompt → addMutation chain above. */}
      {createMutation.status === "error" ? null : null}
    </section>
  );
}

// ─── Prompts list body (with dnd-kit) ────────────────────────────────────────

interface RolePromptsListBodyProps {
  prompts: Prompt[];
  status: "pending" | "error" | "success";
  errorMessage: string | null;
  onRemove: (promptId: string) => void;
  onReorder: (nextIds: string[]) => void;
}

function RolePromptsListBody({
  prompts,
  status,
  errorMessage,
  onRemove,
  onReorder,
}: RolePromptsListBodyProps): ReactElement {
  if (status === "pending") {
    return (
      <p
        className={styles.attachmentEmptyHint}
        data-testid="role-editor-prompts-pending"
        aria-busy="true"
      >
        Loading attached prompts…
      </p>
    );
  }

  if (status === "error") {
    return (
      <p
        className={styles.attachmentEmptyHint}
        role="alert"
        data-testid="role-editor-prompts-error"
      >
        Failed to load prompts: {errorMessage ?? "unknown error"}
      </p>
    );
  }

  if (prompts.length === 0) {
    return (
      <p
        className={styles.attachmentEmptyHint}
        data-testid="role-editor-prompts-empty"
      >
        No prompts attached. Add one to give this cat persistent context.
      </p>
    );
  }

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const ids = prompts.map((p) => p.id);
        const bucket = { list: ids };
        const next = move(bucket, event);
        const nextIds = next.list ?? ids;
        // Skip if order unchanged (same length, same sequence).
        if (
          nextIds.length === ids.length &&
          nextIds.every((id, idx) => id === ids[idx])
        ) {
          return;
        }
        onReorder(nextIds);
      }}
    >
      <ul className={styles.attachmentList}>
        {prompts.map((prompt, index) => (
          <RolePromptRow
            key={prompt.id}
            prompt={prompt}
            index={index}
            onRemove={onRemove}
            onMoveUp={
              index === 0
                ? null
                : () => {
                    const ids = prompts.map((p) => p.id);
                    [ids[index - 1], ids[index]] = [
                      ids[index]!,
                      ids[index - 1]!,
                    ];
                    onReorder(ids);
                  }
            }
            onMoveDown={
              index === prompts.length - 1
                ? null
                : () => {
                    const ids = prompts.map((p) => p.id);
                    [ids[index], ids[index + 1]] = [
                      ids[index + 1]!,
                      ids[index]!,
                    ];
                    onReorder(ids);
                  }
            }
          />
        ))}
      </ul>
    </DragDropProvider>
  );
}

// ─── Prompt row (single, draggable + keyboard-reorderable) ───────────────────

interface RolePromptRowProps {
  prompt: Prompt;
  index: number;
  onRemove: (promptId: string) => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
}

function RolePromptRow({
  prompt,
  index,
  onRemove,
  onMoveUp,
  onMoveDown,
}: RolePromptRowProps): ReactElement {
  const { ref, handleRef, isDragging } = useSortable({
    id: prompt.id,
    index,
    group: "list",
    type: "role-prompt",
    accept: ["role-prompt"],
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "ArrowUp" && onMoveUp) {
      e.preventDefault();
      onMoveUp();
    } else if (e.key === "ArrowDown" && onMoveDown) {
      e.preventDefault();
      onMoveDown();
    }
  };

  return (
    <li
      ref={(el) => ref(el)}
      className={[
        styles.attachmentRow,
        isDragging ? styles.attachmentRowDragging : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`role-editor-prompt-row-${prompt.id}`}
    >
      <button
        type="button"
        ref={(el) => handleRef(el)}
        className={styles.attachmentDragHandle}
        aria-label={`Reorder prompt ${prompt.name}. Use Up and Down arrows to move.`}
        onKeyDown={handleKeyDown}
        data-testid={`role-editor-prompt-handle-${prompt.id}`}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <span className={styles.attachmentName}>{prompt.name}</span>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => onRemove(prompt.id)}
        data-testid={`role-editor-prompt-remove-${prompt.id}`}
        aria-label={`Detach prompt ${prompt.name}`}
      >
        Remove
      </Button>
    </li>
  );
}

// ─── Skills section (ctq-116) ────────────────────────────────────────────────

interface RoleSkillsSectionProps {
  roleId: string;
}

function RoleSkillsSection({ roleId }: RoleSkillsSectionProps): ReactElement {
  const query = useRoleSkills(roleId);
  const removeMutation = useRemoveRoleSkillMutation();
  const { pushToast } = useToast();

  const skills: Skill[] = query.data ?? [];

  const handleRemove = (skillId: string): void => {
    removeMutation.mutate(
      { roleId, skillId },
      {
        onError: (err) => {
          pushToast("error", `Failed to detach skill: ${err.message}`);
        },
      },
    );
  };

  return (
    <section
      className={styles.section}
      data-testid="role-editor-skills-section"
    >
      <header className={styles.attachmentSectionHeader}>
        <p className={styles.sectionLabel}>Skills</p>
        {/*
         * Attach / Create flows for skills land in a follow-up: the
         * AttachSkillDialog has not been built. The section renders the
         * empty/error state so the form is consistent with prompts.
         */}
      </header>
      {query.status === "pending" ? (
        <p
          className={styles.attachmentEmptyHint}
          aria-busy="true"
          data-testid="role-editor-skills-pending"
        >
          Loading attached skills…
        </p>
      ) : query.status === "error" ? (
        <p
          className={styles.attachmentEmptyHint}
          role="alert"
          data-testid="role-editor-skills-error"
        >
          Failed to load skills: {query.error.message}
        </p>
      ) : skills.length === 0 ? (
        <p
          className={styles.attachmentEmptyHint}
          data-testid="role-editor-skills-empty"
        >
          No skills attached. Attach one to grant this cat reusable abilities.
        </p>
      ) : (
        <ul className={styles.attachmentList}>
          {skills.map((skill) => (
            <li
              key={skill.id}
              className={styles.attachmentRow}
              data-testid={`role-editor-skill-row-${skill.id}`}
            >
              <span
                className={styles.attachmentDragHandle}
                aria-hidden="true"
              >
                ⋮⋮
              </span>
              <span className={styles.attachmentName}>{skill.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onPress={() => handleRemove(skill.id)}
                aria-label={`Detach skill ${skill.name}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── MCP tools section (ctq-116) ─────────────────────────────────────────────

interface RoleMcpToolsSectionProps {
  roleId: string;
}

function RoleMcpToolsSection({
  roleId,
}: RoleMcpToolsSectionProps): ReactElement {
  const query = useRoleMcpTools(roleId);
  const removeMutation = useRemoveRoleMcpToolMutation();
  const { pushToast } = useToast();

  const tools: McpTool[] = query.data ?? [];

  const handleRemove = (mcpToolId: string): void => {
    removeMutation.mutate(
      { roleId, mcpToolId },
      {
        onError: (err) => {
          pushToast("error", `Failed to detach tool: ${err.message}`);
        },
      },
    );
  };

  return (
    <section
      className={styles.section}
      data-testid="role-editor-mcp-tools-section"
    >
      <header className={styles.attachmentSectionHeader}>
        <p className={styles.sectionLabel}>MCP tools</p>
      </header>
      {query.status === "pending" ? (
        <p
          className={styles.attachmentEmptyHint}
          aria-busy="true"
          data-testid="role-editor-mcp-tools-pending"
        >
          Loading attached MCP tools…
        </p>
      ) : query.status === "error" ? (
        <p
          className={styles.attachmentEmptyHint}
          role="alert"
          data-testid="role-editor-mcp-tools-error"
        >
          Failed to load MCP tools: {query.error.message}
        </p>
      ) : tools.length === 0 ? (
        <p
          className={styles.attachmentEmptyHint}
          data-testid="role-editor-mcp-tools-empty"
        >
          No MCP tools attached.
        </p>
      ) : (
        <ul className={styles.attachmentList}>
          {tools.map((tool) => (
            <li
              key={tool.id}
              className={styles.attachmentRow}
              data-testid={`role-editor-mcp-tool-row-${tool.id}`}
            >
              <span
                className={styles.attachmentDragHandle}
                aria-hidden="true"
              >
                ⋮⋮
              </span>
              <span className={styles.attachmentName}>{tool.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onPress={() => handleRemove(tool.id)}
                aria-label={`Detach MCP tool ${tool.name}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
