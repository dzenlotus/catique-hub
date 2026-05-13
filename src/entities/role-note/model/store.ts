/**
 * Role-notes query-cache layer (ctq-137 / MEM-S2).
 *
 * Built on `@tanstack/react-query`. Convention mirrors
 * `entities/skill/model/store.ts`: query keys are tuples starting with
 * "role_notes", scoped by `roleId` because notes belong to exactly one
 * role. Mutations invalidate the list key so any mounted
 * `useRoleNotes(roleId)` re-fetches automatically.
 *
 * The `["role_notes"]` root key is also used by `EventsProvider` which
 * invalidates it on `role_note:created`, `role_note:updated`, and
 * `role_note:deleted` realtime events — do not rename without updating
 * that provider.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  addRoleNote,
  deleteRoleNote,
  getRoleNote,
  listRoleNotes,
  listRoleNoteTags,
  updateRoleNote,
  type AddRoleNoteArgs,
  type RoleNoteTagCount,
  type UpdateRoleNoteArgs,
} from "../api";
import type { RoleNote } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const roleNotesKeys = {
  all: ["role_notes"] as const,
  byRole: (roleId: string) => [...roleNotesKeys.all, "byRole", roleId] as const,
  detail: (id: string) => [...roleNotesKeys.all, "detail", id] as const,
};

/** Query-key factory for role-note tag clouds. */
export const roleNoteTagsKeys = {
  all: ["role_note_tags"] as const,
  byRole: (roleId: string) =>
    [...roleNoteTagsKeys.all, "byRole", roleId] as const,
};

/**
 * `useRoleNotes` — list every note belonging to `roleId`.
 *
 * Disabled when `roleId` is empty so mounting the hook with no
 * selection doesn't fire an IPC call.
 */
export function useRoleNotes(
  roleId: string,
): UseQueryResult<RoleNote[], Error> {
  const safeRoleId = typeof roleId === "string" ? roleId : "";
  return useQuery({
    queryKey: roleNotesKeys.byRole(safeRoleId),
    queryFn: () => listRoleNotes(safeRoleId),
    enabled: safeRoleId.length > 0,
  });
}

/**
 * `useRoleNoteTags` — tag counts for `roleId`'s notes. Backs the tag
 * filter chips in `RoleMemorySection`.
 */
export function useRoleNoteTags(
  roleId: string,
): UseQueryResult<RoleNoteTagCount[], Error> {
  const safeRoleId = typeof roleId === "string" ? roleId : "";
  return useQuery({
    queryKey: roleNoteTagsKeys.byRole(safeRoleId),
    queryFn: () => listRoleNoteTags(safeRoleId),
    enabled: safeRoleId.length > 0,
  });
}

/**
 * `useRoleNote` — fetch a single note. Used by edit affordances that
 * want to re-fetch after a race with a realtime update.
 */
export function useRoleNote(id: string): UseQueryResult<RoleNote, Error> {
  const safeId = typeof id === "string" ? id : "";
  return useQuery({
    queryKey: roleNotesKeys.detail(safeId),
    queryFn: () => getRoleNote(safeId),
    enabled: safeId.length > 0,
  });
}

/**
 * `useAddRoleNoteMutation` — create a note, then invalidate the list
 * and tag-cloud caches so any mounted consumer re-fetches.
 */
export function useAddRoleNoteMutation(): UseMutationResult<
  RoleNote,
  Error,
  AddRoleNoteArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addRoleNote,
    onSuccess: (note) => {
      void queryClient.invalidateQueries({
        queryKey: roleNotesKeys.byRole(note.roleId),
      });
      void queryClient.invalidateQueries({
        queryKey: roleNoteTagsKeys.byRole(note.roleId),
      });
    },
  });
}

/**
 * `useUpdateRoleNoteMutation` — partial-update a note. Invalidates list
 * + tag-cloud (tags may have changed) + the specific detail entry.
 */
export function useUpdateRoleNoteMutation(): UseMutationResult<
  RoleNote,
  Error,
  UpdateRoleNoteArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateRoleNote,
    onSuccess: (note) => {
      void queryClient.invalidateQueries({
        queryKey: roleNotesKeys.byRole(note.roleId),
      });
      void queryClient.invalidateQueries({
        queryKey: roleNoteTagsKeys.byRole(note.roleId),
      });
      void queryClient.invalidateQueries({
        queryKey: roleNotesKeys.detail(note.id),
      });
    },
  });
}

/**
 * `useDeleteRoleNoteMutation` — delete a note. The caller passes the
 * `roleId` so we can scope cache invalidation without an extra fetch.
 */
export function useDeleteRoleNoteMutation(): UseMutationResult<
  void,
  Error,
  { id: string; roleId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => deleteRoleNote(id),
    onSuccess: (_data, { id, roleId }) => {
      void queryClient.invalidateQueries({
        queryKey: roleNotesKeys.byRole(roleId),
      });
      void queryClient.invalidateQueries({
        queryKey: roleNoteTagsKeys.byRole(roleId),
      });
      queryClient.removeQueries({ queryKey: roleNotesKeys.detail(id) });
    },
  });
}
