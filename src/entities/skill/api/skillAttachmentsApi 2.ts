/**
 * Skill attachments IPC client (SKILL-S12).
 *
 * Wraps the four Tauri commands shipped by SKILL-S10:
 *
 *  - `list_skill_attachments(skillId)` → `SkillAttachment[]`
 *  - `add_skill_file_attachment(skillId, filename, mimeType, base64Bytes)`
 *  - `add_skill_git_attachment(skillId, gitUrl, gitRef, gitPath)`
 *  - `remove_skill_attachment(attachmentId)`
 *
 * Argument keys are camelCase on the JS side; Tauri v2.x auto-converts to
 * snake_case for the Rust handler.
 *
 * File uploads use base64 transport (the spec). The contract is symmetric
 * with the rest of the entity APIs: a thrown error arrives as a JSON-
 * serialised `AppError` and `invokeWithAppError` re-throws it as
 * `AppErrorInstance` so call-sites can branch on `.error.kind`.
 */

import { invokeWithAppError } from "@shared/api";
import type { SkillAttachment } from "@bindings/SkillAttachment";

/** `list_skill_attachments` — every attachment for the given skill. */
export async function listSkillAttachments(
  skillId: string,
): Promise<SkillAttachment[]> {
  return invokeWithAppError<SkillAttachment[]>("list_skill_attachments", {
    skillId,
  });
}

export interface AddSkillFileAttachmentArgs {
  skillId: string;
  filename: string;
  mimeType: string;
  /** Base64-encoded file bytes (no `data:` prefix). */
  base64Bytes: string;
}

/** `add_skill_file_attachment` — upload bytes, create the metadata row. */
export async function addSkillFileAttachment(
  args: AddSkillFileAttachmentArgs,
): Promise<SkillAttachment> {
  return invokeWithAppError<SkillAttachment>("add_skill_file_attachment", {
    skillId: args.skillId,
    filename: args.filename,
    mimeType: args.mimeType,
    base64Bytes: args.base64Bytes,
  });
}

export interface AddSkillGitAttachmentArgs {
  skillId: string;
  gitUrl: string;
  gitRef: string | null;
  gitPath: string | null;
}

/** `add_skill_git_attachment` — register a git reference. */
export async function addSkillGitAttachment(
  args: AddSkillGitAttachmentArgs,
): Promise<SkillAttachment> {
  return invokeWithAppError<SkillAttachment>("add_skill_git_attachment", {
    skillId: args.skillId,
    gitUrl: args.gitUrl,
    gitRef: args.gitRef,
    gitPath: args.gitPath,
  });
}

/** `remove_skill_attachment` — drop a single attachment row. */
export async function removeSkillAttachment(
  attachmentId: string,
): Promise<void> {
  return invokeWithAppError<void>("remove_skill_attachment", { attachmentId });
}
