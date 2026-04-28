/**
 * `entities/column` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice.
 */

// API
export {
  listColumns,
  getColumn,
  createColumn,
  updateColumn,
  deleteColumn,
  addColumnPrompt,
} from "./api";
export type {
  CreateColumnArgs,
  UpdateColumnArgs,
  AddColumnPromptArgs,
} from "./api";

// Model
export {
  columnsKeys,
  useColumns,
  useColumn,
  useCreateColumnMutation,
  useUpdateColumnMutation,
  useReorderColumnsMutation,
  useDeleteColumnMutation,
  useAddColumnPromptMutation,
} from "./model";
export type { Column, UpdateColumnVars, ReorderColumnsVars } from "./model";

// UI
export { ColumnHeader } from "./ui";
export type { ColumnHeaderProps } from "./ui";
