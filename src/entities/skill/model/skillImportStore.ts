/**
 * Skill import mutation hook (SKILL-V2-B).
 *
 * Backend mutates {skill, skill_attachments, skill_steps} in a single
 * transaction, so on success we invalidate the trio of caches that
 * displays the imported content (overview text + steps list +
 * attachments list). The backend also emits `skill:imported` which
 * EventsProvider treats as a redundant invalidation hint.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import {
  importSkillFromUrl,
  type ImportSkillFromUrlArgs,
} from "../api/skillImportApi";
import { skillsKeys } from "./store";
import { skillStepsKeys } from "./skillStepsStore";
import { skillAttachmentsKeys } from "./skillAttachmentsStore";
import type { ImportReport } from "@bindings/ImportReport";

/**
 * `useImportSkillFromUrlMutation` — fetch + parse markdown from a git
 * URL into the targeted skill's overview/steps/attachments.
 */
export function useImportSkillFromUrlMutation(): UseMutationResult<
  ImportReport,
  Error,
  ImportSkillFromUrlArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importSkillFromUrl,
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: skillsKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: skillsKeys.detail(report.skillId),
      });
      void queryClient.invalidateQueries({
        queryKey: skillStepsKeys.byList(report.skillId),
      });
      void queryClient.invalidateQueries({
        queryKey: skillAttachmentsKeys.byList(report.skillId),
      });
    },
  });
}
