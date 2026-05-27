/**
 * Page: `/boards/:boardId` — kanban board detail.
 *
 * Exposes `BoardDetailPage` as the FSD-canonical name. The legacy
 * `KanbanBoard` export is preserved for callers that still reference
 * it (storybook, tests) until those references are migrated.
 */
export { KanbanBoard as BoardDetailPage, KanbanBoard } from "./KanbanBoard";
export type {
  KanbanBoardProps as BoardDetailPageProps,
  KanbanBoardProps,
} from "./KanbanBoard";
