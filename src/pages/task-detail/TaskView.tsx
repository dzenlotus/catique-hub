/**
 * TaskView — task editor as a routed page (Task B7 restructure).
 *
 * Mounts at `/tasks/:taskId`. Modal-only-on-create rule applies: edit /
 * settings views are routed pages with a `← Back` button.
 *
 * Layout (mirrors the prompt-group inline view):
 *   - 2-column grid. LEFT = the editable task form (`TaskDialogContent`:
 *     title, description, prompt attach, attachments, agent reports).
 *   - RIGHT = `TaskXmlPreview`: a read-only XML rendering of the resolved
 *     task bundle with a reactive token chip. Prompts are inlined; skills
 *     and integrations are rendered as references only.
 *
 * D-020: the form gains no role picker — the board context encodes the
 * role. The XML preview may surface the role-origin of inherited prompts
 * (resolved context), which is informational only.
 */

import { useCallback, type ReactElement } from "react";
import {
  useLocationCompat as useLocation,
  useParamsCompat as useParams,
} from "@shared/lib";

import { Button, Scrollable } from "@shared/ui";
import { TaskDialogContent } from "@features/task/dialog";
import { routes } from "@app/routes";
import { useTaskBundle, useTaskDraft } from "@entities/task";
import { TaskXmlPreview } from "@widgets/effective-context-panel";

import styles from "./TaskView.module.css";

interface TaskViewParams {
  taskId: string;
}

export function TaskView(): ReactElement {
  const params = useParams<TaskViewParams>();
  const taskId = params.taskId ?? "";
  const [, setLocation] = useLocation();

  const handleClose = useCallback((): void => {
    setLocation(routes.home);
  }, [setLocation]);

  return (
    <div className={styles.scrollHost} data-testid="task-view-scroll">
      <div className={styles.root} data-testid="task-view">
        <div className={styles.backRow}>
          <Button
            variant="ghost"
            size="sm"
            onPress={handleClose}
            data-testid="task-view-back"
          >
            ← Back
          </Button>
        </div>

        <div className={styles.body}>
          <Scrollable
            axis="y"
            className={styles.formColumn}
            data-testid="task-view-form-column"
          >
            <div className={styles.formInner}>
              <TaskDialogContent taskId={taskId} onClose={handleClose} />
            </div>
          </Scrollable>

          <div className={styles.previewPane} data-testid="task-view-preview">
            {taskId.length > 0 ? <TaskPreview taskId={taskId} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview pane — reads the resolved bundle and feeds the XML renderer. The
// `tasksKeys.bundle` query re-renders reactively on invalidation (prompt /
// role / override events) so the XML stays in sync with attached context.
// ─────────────────────────────────────────────────────────────────────────────

interface TaskPreviewProps {
  taskId: string;
}

function TaskPreview({ taskId }: TaskPreviewProps): ReactElement {
  const bundleQuery = useTaskBundle(taskId);
  // Live (unsaved) form edits — typing in the title / description on the
  // left updates the right-hand XML preview before Save. Falls back to the
  // saved bundle values when no draft exists.
  const draft = useTaskDraft(taskId);

  if (bundleQuery.status === "pending" || bundleQuery.status === "error") {
    return (
      <TaskXmlPreview
        taskTitle={draft.title}
        taskDescription={draft.description}
        prompts={[]}
        skills={[]}
        mcpTools={[]}
      />
    );
  }

  const bundle = bundleQuery.data;
  return (
    <TaskXmlPreview
      taskTitle={draft.title ?? bundle.task.title}
      taskDescription={draft.description ?? bundle.task.description}
      prompts={bundle.prompts}
      skills={bundle.skills}
      mcpTools={bundle.mcpTools}
    />
  );
}
