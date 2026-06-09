/**
 * Project-files query-cache layer (catique-2, disk-backed).
 *
 * Keys:
 *   - `projectFilesKeys.bySpace(spaceId)` — the settings list.
 *
 * Files are addressed by `(spaceId, name)` — there is no surrogate id, so
 * there is no per-file `detail` key; the list carries each file's
 * content. Mutations invalidate `bySpace(spaceId)`; `EventsProvider`
 * invalidates the same key on the `project_file:*` realtime events for
 * cross-window sync.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  deleteProjectFile,
  listProjectFiles,
  writeProjectFile,
  type DeleteProjectFileArgs,
  type WriteProjectFileArgs,
} from "../api";
import type { ProjectFile } from "./types";

export const projectFilesKeys = {
  all: ["projectFiles"] as const,
  bySpace: (spaceId: string) =>
    [...projectFilesKeys.all, "bySpace", spaceId] as const,
};

/** `useProjectFiles` — every agent file for a space (expected + on-disk). */
export function useProjectFiles(
  spaceId: string,
): UseQueryResult<ProjectFile[], Error> {
  return useQuery({
    queryKey: projectFilesKeys.bySpace(spaceId),
    queryFn: () => listProjectFiles(spaceId),
    enabled: spaceId.length > 0,
  });
}

/** `useWriteProjectFileMutation` — create/overwrite; invalidate the list. */
export function useWriteProjectFileMutation(): UseMutationResult<
  ProjectFile,
  Error,
  WriteProjectFileArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: writeProjectFile,
    onSuccess: (_file, vars) => {
      void queryClient.invalidateQueries({
        queryKey: projectFilesKeys.bySpace(vars.spaceId),
      });
    },
  });
}

/** `useDeleteProjectFileMutation` — remove; invalidate the space list. */
export function useDeleteProjectFileMutation(): UseMutationResult<
  void,
  Error,
  DeleteProjectFileArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProjectFile,
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: projectFilesKeys.bySpace(vars.spaceId),
      });
    },
  });
}
