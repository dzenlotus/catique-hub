export {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
} from "./skillsApi";
export type { CreateSkillArgs, UpdateSkillArgs } from "./skillsApi";

export {
  listSkillAttachments,
  addSkillFileAttachment,
  addSkillGitAttachment,
  removeSkillAttachment,
} from "./skillAttachmentsApi";
export type {
  AddSkillFileAttachmentArgs,
  AddSkillGitAttachmentArgs,
} from "./skillAttachmentsApi";
