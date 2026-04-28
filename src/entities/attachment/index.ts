/**
 * `entities/attachment` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export { listAttachments, getAttachment, deleteAttachment } from "./api";

// Model
export {
  attachmentsKeys,
  useAttachments,
  useAttachmentsByTask,
  useAttachment,
  useDeleteAttachmentMutation,
} from "./model";
export type { Attachment } from "./model";

// UI
export { AttachmentRow } from "./ui";
export type { AttachmentRowProps } from "./ui";
