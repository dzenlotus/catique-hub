/**
 * TaskView — task editor as a routed page (round-19e).
 *
 * Mounts at `/tasks/:taskId`. Replaces the `<TaskDialog>` modal that
 * used to mount over `<BoardHome>` on the same route. UX rule for the
 * app: modals only on create flows; edit/settings opens as a routed
 * page with a `← Back` button — same treatment as `<SpaceSettings>`,
 * `<BoardSettings>`, `<PromptsSettings>`.
 *
 * Reuses `<TaskDialogContent>` so the form fields, mutations, and
 * side-effects live in a single place. Only the wrapping chrome
 * differs — page shell + back row instead of a Dialog.
 */

import { type ReactElement } from "react";
import { useLocation, useParams } from "wouter";

import { Button, Scrollable } from "@shared/ui";
import { TaskDialogContent } from "@widgets/task-dialog";
import { routes } from "@app/routes";

import styles from "./TaskView.module.css";

interface TaskViewParams {
  taskId: string;
}

export function TaskView(): ReactElement {
  const params = useParams<TaskViewParams>();
  const taskId = params.taskId ?? "";
  const [, setLocation] = useLocation();

  // "Close" on a routed page = navigate back to the boards home.
  const handleClose = (): void => {
    setLocation(routes.boards);
  };

  return (
    <Scrollable
      axis="y"
      className={styles.scrollHost}
      data-testid="task-view-scroll"
    >
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
        <TaskDialogContent taskId={taskId} onClose={handleClose} />
      </div>
    </Scrollable>
  );
}
