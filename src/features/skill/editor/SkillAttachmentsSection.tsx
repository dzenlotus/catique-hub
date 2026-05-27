/**
 * SkillAttachmentsSection — file + git attachment UI for the Skill editor.
 *
 * Mounted as a section on `<SkillEditorContent>` (route page + modal both
 * delegate to that body). Only available once the underlying skill row
 * exists — the create dialog deliberately stays minimal per the
 * modal-only-for-creation invariant.
 *
 * Sub-flows:
 *   - **Add file**: hidden `<input type="file">`. Reading goes through
 *     `FileReader.readAsArrayBuffer` → Uint8Array → base64 (chunked to
 *     avoid the call-stack limit `String.fromCharCode.apply` hits at ~10⁴
 *     args). Forwarded to `addSkillFileAttachment`. Tauri's `dialog`
 *     plugin isn't used here because the SKILL-S10 contract specifies a
 *     base64 transport — a `<input type="file">` keeps the browser path
 *     unchanged across macOS / Windows.
 *   - **Add git reference**: inline collapsible form with three inputs
 *     (`url` required, `ref` + `path` optional). Submit calls
 *     `addSkillGitAttachment`; the form collapses on success.
 *
 * Realtime: `EventsProvider` invalidates `skillAttachmentsKeys.byList`
 * on `skill:attachment_added` / `skill:attachment_removed`, so external
 * mutations propagate without extra work here.
 */

import { useRef, useState, type ChangeEvent, type ReactElement } from "react";

import {
  useAddSkillFileAttachmentMutation,
  useAddSkillGitAttachmentMutation,
  useRemoveSkillAttachmentMutation,
  useSkillAttachments,
} from "@entities/skill";
import type { SkillAttachment } from "@entities/skill";
import { useToast } from "@app/providers/ToastProvider";
import { Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./SkillAttachmentsSection.module.css";

export interface SkillAttachmentsSectionProps {
  skillId: string;
}

/**
 * `SkillAttachmentsSection` — attachments block on the Skill editor body.
 */
export function SkillAttachmentsSection({
  skillId,
}: SkillAttachmentsSectionProps): ReactElement {
  const query = useSkillAttachments(skillId);

  return (
    <div
      className={styles.section}
      data-testid="skill-attachments-section"
    >
      <div className={styles.header}>
        <h3 className={styles.title}>Attachments</h3>
      </div>

      {query.status === "pending" ? (
        <div
          className={styles.skeletonStack}
          aria-busy="true"
          data-testid="skill-attachments-section-pending"
        >
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </div>
      ) : query.status === "error" ? (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="skill-attachments-section-error"
        >
          <p className={styles.errorMessage}>
            Failed to load attachments: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (
        <SkillAttachmentsBody skillId={skillId} attachments={query.data} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface SkillAttachmentsBodyProps {
  skillId: string;
  attachments: SkillAttachment[];
}

function SkillAttachmentsBody({
  skillId,
  attachments,
}: SkillAttachmentsBodyProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isGitFormOpen, setIsGitFormOpen] = useState(false);

  const uploadMutation = useAddSkillFileAttachmentMutation();
  const gitMutation = useAddSkillGitAttachmentMutation();
  const removeMutation = useRemoveSkillAttachmentMutation();
  const { pushToast } = useToast();

  const handleAddFileClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Always reset value so re-picking the same file fires `change` again.
    event.target.value = "";
    if (!file) return;

    void (async () => {
      try {
        const base64Bytes = await fileToBase64(file);
        uploadMutation.mutate(
          {
            skillId,
            filename: file.name,
            mimeType: file.type !== "" ? file.type : "application/octet-stream",
            base64Bytes,
          },
          {
            onSuccess: () => {
              pushToast("success", "File attached");
            },
            onError: (err) => {
              pushToast("error", `Failed to attach file: ${err.message}`);
            },
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushToast("error", `Failed to read file: ${message}`);
      }
    })();
  };

  const handleRemove = (attachmentId: string): void => {
    removeMutation.mutate(attachmentId, {
      onSuccess: () => {
        pushToast("success", "Attachment removed");
      },
      onError: (err) => {
        pushToast("error", `Failed to remove attachment: ${err.message}`);
      },
    });
  };

  const handleGitSubmit = (args: {
    gitUrl: string;
    gitRef: string | null;
    gitPath: string | null;
  }): void => {
    gitMutation.mutate(
      { skillId, ...args },
      {
        onSuccess: () => {
          pushToast("success", "Git reference attached");
          setIsGitFormOpen(false);
        },
        onError: (err) => {
          pushToast("error", `Failed to attach git reference: ${err.message}`);
        },
      },
    );
  };

  return (
    <>
      <div className={styles.toolbar}>
        <Button
          variant="secondary"
          size="sm"
          isPending={uploadMutation.status === "pending"}
          onPress={handleAddFileClick}
          data-testid="skill-attachments-add-file-btn"
        >
          + Add file
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => setIsGitFormOpen((v) => !v)}
          data-testid="skill-attachments-add-git-btn"
        >
          + Add git reference
        </Button>
        {/* Hidden picker — clicked by the "Add file" button. */}
        <input
          ref={fileInputRef}
          type="file"
          className={styles.hiddenFileInput}
          onChange={handleFileChange}
          data-testid="skill-attachments-file-input"
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {isGitFormOpen ? (
        <GitReferenceForm
          isPending={gitMutation.status === "pending"}
          onCancel={() => setIsGitFormOpen(false)}
          onSubmit={handleGitSubmit}
        />
      ) : null}

      {attachments.length === 0 ? (
        <p
          className={styles.emptyHint}
          data-testid="skill-attachments-empty"
        >
          No attachments. Add a file or git reference to make tools/files
          available to the agent.
        </p>
      ) : (
        <ul className={styles.list} data-testid="skill-attachments-list">
          {attachments.map((attachment) => (
            <li key={attachment.id} className={styles.listItem}>
              <AttachmentRow
                attachment={attachment}
                onRemove={handleRemove}
                isRemoving={
                  removeMutation.status === "pending" &&
                  removeMutation.variables === attachment.id
                }
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface AttachmentRowProps {
  attachment: SkillAttachment;
  onRemove: (id: string) => void;
  isRemoving: boolean;
}

function AttachmentRow({
  attachment,
  onRemove,
  isRemoving,
}: AttachmentRowProps): ReactElement {
  const isFile = attachment.kind === "file";
  return (
    <div
      className={styles.row}
      data-testid={`skill-attachment-row-${attachment.id}`}
    >
      <span
        className={cn(styles.kindBadge, isFile ? styles.kindFile : styles.kindGit)}
        aria-label={isFile ? "File attachment" : "Git reference"}
      >
        {isFile ? "FILE" : "GIT"}
      </span>

      <div className={styles.rowBody}>
        {isFile ? (
          <FileRowBody attachment={attachment} />
        ) : (
          <GitRowBody attachment={attachment} />
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        aria-label={`Remove attachment ${attachment.filename ?? attachment.gitUrl ?? attachment.id}`}
        isDisabled={isRemoving}
        isPending={isRemoving}
        onPress={() => onRemove(attachment.id)}
        className={styles.removeButton}
        data-testid={`skill-attachment-remove-${attachment.id}`}
      >
        ×
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function FileRowBody({
  attachment,
}: {
  attachment: SkillAttachment;
}): ReactElement {
  const filename = attachment.filename ?? "(unnamed)";
  const sizeLabel = attachment.sizeBytes !== null
    ? formatBytes(attachment.sizeBytes)
    : "—";
  const mimeLabel = attachment.mimeType !== null
    ? mimeShortcode(attachment.mimeType)
    : "—";
  return (
    <>
      <span className={styles.primaryText} title={filename}>
        {filename}
      </span>
      <span className={styles.metaText}>{sizeLabel}</span>
      <span className={styles.metaText}>{mimeLabel}</span>
    </>
  );
}

function GitRowBody({
  attachment,
}: {
  attachment: SkillAttachment;
}): ReactElement {
  const url = attachment.gitUrl ?? "";
  const shortUrl = shortenGitUrl(url);
  const refLabel = attachment.gitRef !== null && attachment.gitRef !== ""
    ? `@${attachment.gitRef}`
    : "";
  const pathLabel = attachment.gitPath !== null && attachment.gitPath !== ""
    ? attachment.gitPath
    : "";
  return (
    <>
      <span className={styles.primaryText} title={url}>
        {shortUrl}
        {refLabel ? <span className={styles.gitRef}> {refLabel}</span> : null}
      </span>
      {pathLabel !== "" ? (
        <span className={styles.metaText} title={pathLabel}>
          {pathLabel}
        </span>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface GitReferenceFormProps {
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (args: {
    gitUrl: string;
    gitRef: string | null;
    gitPath: string | null;
  }) => void;
}

function GitReferenceForm({
  isPending,
  onCancel,
  onSubmit,
}: GitReferenceFormProps): ReactElement {
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [path, setPath] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (): void => {
    const trimmedUrl = url.trim();
    if (trimmedUrl === "") {
      setValidationError("URL is required.");
      return;
    }
    setValidationError(null);
    onSubmit({
      gitUrl: trimmedUrl,
      gitRef: ref.trim() === "" ? null : ref.trim(),
      gitPath: path.trim() === "" ? null : path.trim(),
    });
  };

  return (
    <div
      className={styles.gitForm}
      data-testid="skill-attachments-git-form"
    >
      <Input
        label="URL"
        value={url}
        onChange={setUrl}
        placeholder="https://github.com/owner/repo.git"
        className={styles.gitFormInput}
        data-testid="skill-attachments-git-url-input"
      />
      <div className={styles.gitFormRow}>
        <Input
          label="Ref (optional)"
          value={ref}
          onChange={setRef}
          placeholder="main"
          className={styles.gitFormInputSmall}
          data-testid="skill-attachments-git-ref-input"
        />
        <Input
          label="Path (optional)"
          value={path}
          onChange={setPath}
          placeholder="scripts/run.sh"
          className={styles.gitFormInputSmall}
          data-testid="skill-attachments-git-path-input"
        />
      </div>
      {validationError !== null ? (
        <p
          className={styles.formError}
          role="alert"
          data-testid="skill-attachments-git-form-error"
        >
          {validationError}
        </p>
      ) : null}
      <div className={styles.gitFormActions}>
        <Button
          variant="ghost"
          size="sm"
          onPress={onCancel}
          data-testid="skill-attachments-git-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          isPending={isPending}
          onPress={handleSubmit}
          data-testid="skill-attachments-git-submit"
        >
          Attach
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a `File` and return its bytes as a base64-encoded string.
 *
 * `btoa` only takes binary strings (one char ≈ one byte). We build that
 * string in 32 KiB chunks because `String.fromCharCode.apply(null, big)`
 * blows the call stack at ~10⁴ args on most engines.
 */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32 KiB
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Format a `bigint` byte count as a humanised size. */
function formatBytes(input: bigint | number): string {
  const bytes = typeof input === "bigint" ? Number(input) : input;
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const formatted =
    value < 100 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${units[i]}`;
}

/** `"image/png"` → `"PNG"`, `"application/vnd.foo+json"` → `"VND"`. */
function mimeShortcode(mimeType: string): string {
  const subtype = mimeType.split("/")[1] ?? mimeType;
  return subtype.split("+")[0]!.toUpperCase().slice(0, 6);
}

/** Strip scheme + `.git` suffix for compact display. */
function shortenGitUrl(url: string): string {
  if (url === "") return "(no url)";
  const withoutScheme = url
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/^ssh:\/\//, "");
  return withoutScheme.replace(/\.git$/, "");
}
