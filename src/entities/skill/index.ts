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
} from "./api";
export type { CreateSkillArgs, UpdateSkillArgs } from "./api";

// Model
export {
  skillsKeys,
  useSkills,
  useSkill,
  useCreateSkillMutation,
  useUpdateSkillMutation,
  useDeleteSkillMutation,
} from "./model";
export type { Skill } from "./model";

// UI
export { SkillCard } from "./ui";
export type { SkillCardProps } from "./ui";
