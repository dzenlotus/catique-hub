/**
 * `entities/pinned-board` — public surface (FSD encapsulation).
 *
 * Refactor-v3 D-F. Backs the AppSidebar's Pinned section. The slice
 * holds the IPC client + TanStack-Query hooks; the UI rendering lives
 * in `widgets/app-sidebar` (Stream L).
 *
 * Internal modules under `./api` and `./model` MUST NOT be imported
 * directly from outside this slice. Anything not re-exported here is
 * private to the entity.
 */

export {
  listPinnedBoards,
  pinBoard,
  unpinBoard,
  reorderPinned,
} from "./api";

export {
  pinnedBoardsKeys,
  usePinnedBoards,
  usePinBoardMutation,
  useUnpinBoardMutation,
  useReorderPinnedMutation,
  useReorderPinnedListMutation,
} from "./model";
export type { ReorderPinnedArgs } from "./model";
