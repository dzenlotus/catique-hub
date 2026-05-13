/**
 * `entities/role-note` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api` and `./model` MUST NOT be imported
 * directly from outside this slice. Anything not re-exported here is
 * private to the entity.
 */

// API
export {
  listRoleNotes,
  listRoleNoteTags,
  getRoleNote,
  addRoleNote,
  updateRoleNote,
  deleteRoleNote,
} from "./api";
export type {
  AddRoleNoteArgs,
  UpdateRoleNoteArgs,
  RoleNoteTagCount,
} from "./api";

// Model
export {
  roleNotesKeys,
  roleNoteTagsKeys,
  useRoleNotes,
  useRoleNoteTags,
  useRoleNote,
  useAddRoleNoteMutation,
  useUpdateRoleNoteMutation,
  useDeleteRoleNoteMutation,
} from "./model";
export type { RoleNote, RoleNoteAuthor } from "./model";
