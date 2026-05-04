/**
 * `entities/board` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listBoards,
  getBoard,
  createBoard,
  updateBoard,
  deleteBoard,
  addBoardPrompt,
  AppErrorInstance,
} from "./api";
export type { CreateBoardArgs, UpdateBoardArgs, AddBoardPromptArgs } from "./api";

// Model
export {
  boardsKeys,
  useBoards,
  useBoard,
  useCreateBoardMutation,
  useUpdateBoardMutation,
  useDeleteBoardMutation,
  useAddBoardPromptMutation,
} from "./model";
export type { Board } from "./model";

// UI
export { BoardCard } from "./ui";
export type { BoardCardProps } from "./ui";
