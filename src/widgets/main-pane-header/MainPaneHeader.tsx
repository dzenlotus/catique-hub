/**
 * MainPaneHeader — contextual strip at the top of the main pane.
 *
 * Left side:  current view label + matching lucide icon; for board-detail
 *             and task-detail routes, shows a two-segment breadcrumb.
 * Right side: active-space prefix badge (non-interactive indicator).
 *
 * Sticky-positioned so it stays visible as the pane scrolls below it.
 */

import type { ReactElement, ReactNode } from "react";
import { useLocation, useRoute } from "wouter";

import { useBoard } from "@entities/board";
import { useTask } from "@entities/task";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { useSpaces } from "@entities/space";
import { viewForPath } from "@app/routes";
import { cn } from "@shared/lib";

import { NAV_LABELS } from "./labels";
import styles from "./MainPaneHeader.module.css";

// ---------------------------------------------------------------------------
// Internal breadcrumb helpers
// ---------------------------------------------------------------------------

interface BreadcrumbProps {
  segments: [string, ...string[]];
  Icon: ReactNode;
}

function Breadcrumb({ segments, Icon }: BreadcrumbProps): ReactElement {
  return (
    <div className={styles.breadcrumb} aria-label="Навигационная цепочка">
      <span className={styles.icon} aria-hidden="true">
        {Icon}
      </span>
      {segments.map((segment, idx) => (
        <span key={idx} className={styles.breadcrumbRow}>
          {idx > 0 && (
            <span className={styles.separator} aria-hidden="true">
              /
            </span>
          )}
          <span
            className={cn(
              styles.segment,
              idx === segments.length - 1 && styles.segmentCurrent,
            )}
          >
            {segment}
          </span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board-detail breadcrumb — fetches board name via useBoard
// ---------------------------------------------------------------------------

function BoardDetailBreadcrumb({ boardId }: { boardId: string }): ReactElement {
  const { Icon, label } = NAV_LABELS["boards"]!;
  const boardQuery = useBoard(boardId);

  const boardName =
    boardQuery.status === "success"
      ? boardQuery.data.name
      : boardQuery.status === "pending"
        ? "…"
        : "Доска";

  return (
    <Breadcrumb
      segments={[label, boardName]}
      Icon={<Icon size={16} aria-hidden={true} />}
    />
  );
}

// ---------------------------------------------------------------------------
// Task-detail breadcrumb — fetches task title via useTask
// ---------------------------------------------------------------------------

function TaskDetailBreadcrumb({ taskId }: { taskId: string }): ReactElement {
  const { Icon, label } = NAV_LABELS["boards"]!;
  const taskQuery = useTask(taskId);

  const taskTitle =
    taskQuery.status === "success"
      ? taskQuery.data.title
      : taskQuery.status === "pending"
        ? "…"
        : "Задача";

  return (
    <Breadcrumb
      segments={[label, taskTitle]}
      Icon={<Icon size={16} aria-hidden={true} />}
    />
  );
}

// ---------------------------------------------------------------------------
// Active-space badge
// ---------------------------------------------------------------------------

function SpaceBadge(): ReactElement | null {
  const { activeSpaceId } = useActiveSpace();
  const spacesQuery = useSpaces();

  if (activeSpaceId === null || spacesQuery.status !== "success") return null;

  const space = spacesQuery.data.find((s) => s.id === activeSpaceId);
  if (!space) return null;

  return (
    <span
      className={styles.spaceBadge}
      aria-label={`Активное пространство: ${space.name}`}
      data-testid="main-pane-header-space-badge"
    >
      {space.prefix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MainPaneHeader(): ReactElement {
  const [location] = useLocation();

  // Check specific parameterised routes first.
  const [isBoardDetail, boardParams] = useRoute<{ boardId: string }>(
    "/boards/:boardId",
  );
  const [isTaskDetail, taskParams] = useRoute<{ taskId: string }>(
    "/tasks/:taskId",
  );

  let left: ReactElement;

  if (isBoardDetail && boardParams) {
    left = <BoardDetailBreadcrumb boardId={boardParams.boardId} />;
  } else if (isTaskDetail && taskParams) {
    left = <TaskDetailBreadcrumb taskId={taskParams.taskId} />;
  } else {
    const view = viewForPath(location);
    const entry = NAV_LABELS[view];

    if (entry) {
      const { Icon, label } = entry;
      left = (
        <div className={styles.breadcrumb}>
          <span className={styles.icon} aria-hidden="true">
            <Icon size={16} aria-hidden={true} />
          </span>
          <span className={cn(styles.segment, styles.segmentCurrent)}>
            {label}
          </span>
        </div>
      );
    } else {
      left = <div className={styles.breadcrumb} />;
    }
  }

  return (
    <header className={styles.header} data-testid="main-pane-header">
      <div className={styles.left}>{left}</div>
      <div className={styles.right}>
        <SpaceBadge />
      </div>
    </header>
  );
}
