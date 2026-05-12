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
} from "./api";
export type {
  CreateSkillArgs,
  UpdateSkillArgs,
  AddSkillFileAttachmentArgs,
  AddSkillGitAttachmentArgs,
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
} from "./model";
export type { Skill } from "./model";
export type { SkillAttachment } from "@bindings/SkillAttachment";
export type { SkillAttachmentKind } from "@bindings/SkillAttachmentKind";

// UI
export { SkillCard } from "./ui";
export type { SkillCardProps } from "./ui";
