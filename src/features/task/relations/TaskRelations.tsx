/**
 * TaskRelations — the catique-4 "linked tasks" surface.
 *
 * Renders inside the task editor (`TaskDialogContent`). Lets the user
 * express a simple relationship between the current task and another:
 *
 *   - `related` — symmetric "see also".
 *   - `blocks`  — this task blocks the target.
 *   - `parent`  — the target is a sub-task of this task.
 *
 * The model is intentionally tiny (the product ask was "make it very
 * simple"). Direction is always authored from the current task's point
 * of view: the picked task becomes the `dst` endpoint. Existing links
 * are rendered with a human label that re-states direction relative to
 * the task being viewed, so a `blocks` link shows as "Blocks X" on the
 * source and "Blocked by X" on the target.
 */

import { useCallback, useMemo, useState, type ReactElement, type Key } from "react";

import {
  useAllTasks,
  useTaskLinks,
  useLinkTasksMutation,
  useUnlinkTasksMutation,
} from "@entities/task";
import { Button, Combobox, GroupButton } from "@shared/ui";
import { useToast } from "@shared/lib";
import type { TaskLink } from "@bindings/TaskLink";
import type { TaskLinkKind } from "@bindings/TaskLinkKind";

import styles from "./TaskRelations.module.css";

const KIND_OPTIONS: ReadonlyArray<{ id: TaskLinkKind; label: string }> = [
  { id: "related", label: "Related" },
  { id: "blocks", label: "Blocks" },
  { id: "parent", label: "Sub-task" },
];

export interface TaskRelationsProps {
  taskId: string;
}

export function TaskRelations({ taskId }: TaskRelationsProps): ReactElement {
  const linksQuery = useTaskLinks(taskId);
  const allTasksQuery = useAllTasks();
  const linkMutation = useLinkTasksMutation();
  const unlinkMutation = useUnlinkTasksMutation();
  const toast = useToast();

  const [kind, setKind] = useState<TaskLinkKind>("related");
  const [targetId, setTargetId] = useState<string | null>(null);

  // Map id → title/slug so links can render a meaningful label.
  const tasksById = useMemo(() => {
    const map = new Map<string, { title: string; slug: string }>();
    for (const t of allTasksQuery.data ?? []) {
      map.set(t.id, { title: t.title, slug: t.slug });
    }
    return map;
  }, [allTasksQuery.data]);

  const links = linksQuery.data ?? [];

  // Candidate tasks for the picker: everything except the current task.
  const pickerItems = useMemo(() => {
    return (allTasksQuery.data ?? [])
      .filter((t) => t.id !== taskId)
      .map((t) => ({ id: t.id, label: t.title, detail: t.slug }));
  }, [allTasksQuery.data, taskId]);

  const handleAdd = useCallback((): void => {
    if (targetId === null) return;
    linkMutation.mutate(
      { srcTaskId: taskId, dstTaskId: targetId, kind },
      {
        onSuccess: () => {
          setTargetId(null);
        },
        onError: (err) => {
          toast.pushToast(
            "error",
            err instanceof Error ? err.message : "Failed to link tasks",
          );
        },
      },
    );
  }, [targetId, taskId, kind, linkMutation, toast]);

  const handleRemove = useCallback(
    (link: TaskLink): void => {
      unlinkMutation.mutate(
        {
          srcTaskId: link.srcTaskId,
          dstTaskId: link.dstTaskId,
          kind: link.kind,
        },
        {
          onError: (err) => {
            toast.pushToast(
              "error",
              err instanceof Error ? err.message : "Failed to unlink tasks",
            );
          },
        },
      );
    },
    [unlinkMutation, toast],
  );

  return (
    <div className={styles.root} data-testid="task-relations">
      {links.length === 0 ? (
        <p className={styles.empty} data-testid="task-relations-empty">
          No linked tasks
        </p>
      ) : (
        <ul className={styles.list}>
          {links.map((link) => {
            const otherId =
              link.srcTaskId === taskId ? link.dstTaskId : link.srcTaskId;
            const other = tasksById.get(otherId);
            return (
              <li
                key={`${link.srcTaskId}:${link.dstTaskId}:${link.kind}`}
                className={styles.row}
                data-testid="task-relations-row"
              >
                <span className={styles.relationLabel}>
                  {relationLabel(link, taskId)}
                </span>
                <span className={styles.targetTitle}>
                  {other ? other.title : otherId}
                  {other ? (
                    <span className={styles.targetSlug}> ({other.slug})</span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => handleRemove(link)}
                  aria-label="Remove link"
                  data-testid="task-relations-remove"
                >
                  ✕
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.addRow} data-testid="task-relations-add">
        <GroupButton
          selectionMode="single"
          selectedKey={kind}
          onSelectionChange={(key: Key) => setKind(key as TaskLinkKind)}
          size="sm"
          ariaLabel="Link kind"
          testId="task-relations-kind"
        >
          {KIND_OPTIONS.map((opt) => (
            <GroupButton.Item key={opt.id} id={opt.id}>
              {opt.label}
            </GroupButton.Item>
          ))}
        </GroupButton>

        <div className={styles.picker}>
          <Combobox
            label="Link to task"
            aria-label="Link to task"
            items={pickerItems}
            placeholder="Search tasks…"
            selectedKey={targetId}
            onSelectionChange={(key) =>
              setTargetId(key === null ? null : String(key))
            }
            emptyState={<span>No matching tasks</span>}
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          isDisabled={targetId === null}
          isPending={linkMutation.status === "pending"}
          onPress={handleAdd}
          data-testid="task-relations-add-btn"
        >
          Link
        </Button>
      </div>
    </div>
  );
}

/**
 * Human label for a link, re-stated relative to the task being viewed.
 * `viewerId` is the task whose detail panel is open.
 */
function relationLabel(link: TaskLink, viewerId: string): string {
  const isSource = link.srcTaskId === viewerId;
  switch (link.kind) {
    case "related":
      return "Related to";
    case "blocks":
      return isSource ? "Blocks" : "Blocked by";
    case "parent":
      return isSource ? "Sub-task" : "Parent";
    default:
      return "Linked to";
  }
}
