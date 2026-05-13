/**
 * `entities/skill` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  listSkillAttachments,
  addSkillFileAttachment,
  addSkillGitAttachment,
  removeSkillAttachment,
  listSkillSteps,
  addSkillStep,
  updateSkillStep,
  deleteSkillStep,
  reorderSkillSteps,
  importSkillFromUrl,
} from "./api";
export type {
  CreateSkillArgs,
  UpdateSkillArgs,
  AddSkillFileAttachmentArgs,
  AddSkillGitAttachmentArgs,
  AddSkillStepArgs,
  UpdateSkillStepArgs,
  ReorderSkillStepsArgs,
  ImportSkillFromUrlArgs,
} from "./api";

// Model
export {
  skillsKeys,
  useSkills,
  useSkill,
  useCreateSkillMutation,
  useUpdateSkillMutation,
  useDeleteSkillMutation,
  skillAttachmentsKeys,
  useSkillAttachments,
  useAddSkillFileAttachmentMutation,
  useAddSkillGitAttachmentMutation,
  useRemoveSkillAttachmentMutation,
  skillStepsKeys,
  useSkillSteps,
  useAddSkillStepMutation,
  useUpdateSkillStepMutation,
  useDeleteSkillStepMutation,
  useReorderSkillStepsMutation,
  useImportSkillFromUrlMutation,
} from "./model";
export type { Skill } from "./model";
export type { SkillAttachment } from "@bindings/SkillAttachment";
export type { SkillAttachmentKind } from "@bindings/SkillAttachmentKind";
export type { SkillStep } from "@bindings/SkillStep";
export type { ImportReport } from "@bindings/ImportReport";

// UI
export { SkillCard } from "./ui";
export type { SkillCardProps } from "./ui";
