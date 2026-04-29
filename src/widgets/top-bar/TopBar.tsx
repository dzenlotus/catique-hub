/**
 * TopBar — верхняя панель главного pane.
 *
 * Анатомия (слева направо):
 * - Поле поиска (flex-grow, max 480 px).  Клик → открывает GlobalSearch.
 * - Хлебная крошка (опционально) — для /boards/:id и /tasks/:id.
 * - Spacer.
 * - Кнопка «+ Новая задача» (CTA красная).
 * - Иконка настроек (ghost) → /settings.
 * - Иконка уведомлений (ghost) → TODO v2.
 * - Аватар (round, инициал M).
 *
 * Высота: 56 px.
 * Фон: var(--color-surface-topbar).
 * Нижняя граница: 1px solid var(--color-border-subtle).
 */

import { useState, useCallback, type ReactElement } from "react";
import { Search, Plus, SlidersHorizontal, Activity } from "lucide-react";
import { useLocation, useRoute } from "wouter";

import { useBoard } from "@entities/board";
import { useTask } from "@entities/task";
import { GlobalSearch, useGlobalSearchKeybind } from "@widgets/global-search";
import { TaskCreateDialog } from "@widgets/task-create-dialog";
import { cn } from "@shared/lib";

import { NAV_LABELS } from "./labels";
import { useNewTaskKeybind } from "./useNewTaskKeybind";
import styles from "./TopBar.module.css";

// ---------------------------------------------------------------------------
// Breadcrumb helpers (adapted from MainPaneHeader)
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
    <span className={styles.breadcrumb} aria-label="Навигационная цепочка">
      <Icon size={13} aria-hidden={true} className={styles.breadcrumbIcon} />
      <span className={styles.breadcrumbSeg}>{label}</span>
      <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
      <span className={cn(styles.breadcrumbSeg, styles.breadcrumbCurrent)}>
        {boardName}
      </span>
    </span>
  );
}

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
    <span className={styles.breadcrumb} aria-label="Навигационная цепочка">
      <Icon size={13} aria-hidden={true} className={styles.breadcrumbIcon} />
      <span className={styles.breadcrumbSeg}>{label}</span>
      <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
      <span className={cn(styles.breadcrumbSeg, styles.breadcrumbCurrent)}>
        {taskTitle}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function Avatar(): ReactElement {
  return (
    <button
      type="button"
      className={styles.avatar}
      aria-label="Профиль пользователя"
      data-testid="top-bar-avatar"
      // TODO v2: открыть меню пользователя
    >
      C
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TopBar(): ReactElement {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [location, setLocation] = useLocation();

  const [isBoardDetail, boardParams] = useRoute<{ boardId: string }>(
    "/boards/:boardId",
  );
  const [isTaskDetail, taskParams] = useRoute<{ taskId: string }>(
    "/tasks/:taskId",
  );

  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);

  // Bind ⌘K / Ctrl+K globally.
  useGlobalSearchKeybind(openSearch);

  // Bind ⌘N / Ctrl+N globally.
  useNewTaskKeybind(useCallback(() => setIsCreateOpen(true), []));

  // Breadcrumb — only on board/task detail routes.
  let breadcrumb: ReactElement | null = null;
  if (isBoardDetail && boardParams) {
    breadcrumb = <BoardDetailBreadcrumb boardId={boardParams.boardId} />;
  } else if (isTaskDetail && taskParams) {
    breadcrumb = <TaskDetailBreadcrumb taskId={taskParams.taskId} />;
  }

  // Suppress unused-var warning: `location` is read for re-render on navigation
  void location;

  return (
    <>
      <header className={styles.topBar} data-testid="top-bar">
        {/* ── Search trigger ────────────────────────────────────────────── */}
        <button
          type="button"
          className={styles.searchTrigger}
          onClick={openSearch}
          aria-label="Открыть глобальный поиск"
          data-testid="top-bar-search-trigger"
        >
          <Search
            size={15}
            className={styles.searchIcon}
            aria-hidden="true"
          />
          <span className={styles.searchPlaceholder}>Search tasks, boards, agents...</span>
          <kbd className={styles.kbdHint} aria-label="Горячая клавиша ⌘K">
            ⌘K
          </kbd>
        </button>

        {/* ── Breadcrumb ────────────────────────────────────────────────── */}
        {breadcrumb !== null && (
          <div className={styles.breadcrumbWrap}>{breadcrumb}</div>
        )}

        {/* ── Spacer ────────────────────────────────────────────────────── */}
        <div className={styles.spacer} aria-hidden="true" />

        {/* ── Right actions: CTA + icon buttons + avatar ───────────────── */}
        <div className={styles.actionsRow}>
          {/* ── «+ New task» CTA ──────────────────────────────────────────── */}
          <button
            type="button"
            className={styles.ctaButton}
            onClick={() => setIsCreateOpen(true)}
            data-testid="top-bar-new-task"
            aria-label="Новая задача"
          >
            <Plus size={14} aria-hidden="true" />
            <span>New task</span>
          </button>

          {/* ── Settings (sliders) icon button ──────────────────────────── */}
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Настройки"
            data-testid="top-bar-settings"
            onClick={() => setLocation("/settings")}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
          </button>

          {/* ── Activity / heartbeat icon button ─────────────────────────── */}
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Уведомления"
            data-testid="top-bar-bell"
            // TODO v2: открыть панель уведомлений
          >
            <Activity size={16} aria-hidden="true" />
          </button>

          {/* ── Avatar ───────────────────────────────────────────────────── */}
          <Avatar />
        </div>
      </header>

      {/* GlobalSearch palette — mounted here so it's not sidebar-dependent */}
      <GlobalSearch isOpen={isSearchOpen} onClose={closeSearch} />

      {/* TaskCreateDialog */}
      <TaskCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </>
  );
}
