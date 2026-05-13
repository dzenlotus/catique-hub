/**
 * Skill attachments query-cache layer (SKILL-S12).
 *
 * Pattern mirrors `entities/skill/model/store.ts`:
 * - query-key factory keeps invalidation paths in one place.
 * - mutations invalidate the per-skill list key on success so any mounted
 *   `useSkillAttachments(skillId)` re-fetches automatically.
 *
 * `skillAttachmentsKeys.byList` is also the key the `EventsProvider`
 * invalidates on `skill:attachment_added` / `skill:attachment_removed` —
 * do not rename without updating that provider.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  addSkillFileAttachment,
  addSkillGitAttachment,
  listSkillAttachments,
  removeSkillAttachment,
  type AddSkillFileAttachmentArgs,
  type AddSkillGitAttachmentArgs,
} from "../api";
import type { SkillAttachment } from "@bindings/SkillAttachment";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const skillAttachmentsKeys = {
  all: ["skillAttachments"] as const,
  byList: (skillId: string) =>
    [...skillAttachmentsKeys.all, skillId] as const,
};

/**
 * `useSkillAttachments` — list every attachment for the given skill.
 *
 * Disabled when `skillId` is empty so mounting without a selection
 * doesn't fire an IPC call.
 */
export function useSkillAttachments(
  skillId: string,
): UseQueryResult<SkillAttachment[], Error> {
  return useQuery({
    queryKey: skillAttachmentsKeys.byList(skillId),
    queryFn: () => listSkillAttachments(skillId),
    enabled: skillId.length > 0,
  });
}

/**
 * `useAddSkillFileAttachmentMutation` — upload a file as base64.
 * Invalidates the per-skill list cache on success.
 */
export function useAddSkillFileAttachmentMutation(): UseMutationResult<
  SkillAttachment,
  Error,
  AddSkillFileAttachmentArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addSkillFileAttachment,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: skillAttachmentsKeys.byList(args.skillId),
      });
    },
  });
}

/**
 * `useAddSkillGitAttachmentMutation` — register a git reference.
 * Invalidates the per-skill list cache on success.
 */
export function useAddSkillGitAttachmentMutation(): UseMutationResult<
  SkillAttachment,
  Error,
  AddSkillGitAttachmentArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addSkillGitAttachment,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: skillAttachmentsKeys.byList(args.skillId),
      });
    },
  });
}

/**
 * `useRemoveSkillAttachmentMutation` — delete a single attachment row.
 *
 * The skill id isn't part of the mutation variables (the IPC only needs
 * the attachment id), so on success we invalidate every list under the
 * root `skillAttachments` key. The backend also emits
 * `skill:attachment_removed` so `EventsProvider` provides a second-line
 * invalidation if any race trims the cache while a request is in flight.
 */
export function useRemoveSkillAttachmentMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeSkillAttachment,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: skillAttachmentsKeys.all,
      });
    },
  });
}
