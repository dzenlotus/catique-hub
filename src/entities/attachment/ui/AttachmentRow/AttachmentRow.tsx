import type { ReactElement } from "react";

import { cn } from "@shared/lib";
import { Button } from "@shared/ui";

import type { Attachment } from "../../model/types";

import styles from "./AttachmentRow.module.css";

// ── formatBytes ────────────────────────────────────────────────────
// Inline helper — `@shared/lib` does not export `formatBytes` yet.
// When a second consumer outside this slice appears, lift to `@shared/lib`.
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

// ── mimeTypeShortcode ──────────────────────────────────────────────
function mimeTypeShortcode(mimeType: string): string {
  // e.g. "image/png" → "PNG", "application/pdf" → "PDF"
  const subtype = mimeType.split("/")[1] ?? mimeType;
  return subtype.split("+")[0]!.toUpperCase().slice(0, 6);
}

// ── Props ──────────────────────────────────────────────────────────

export interface AttachmentRowProps {
  attachment: Attachment;
  /** Called with the attachment id when the delete button is pressed. */
  onDelete?: (id: string) => void;
  /** Shows a spinner on the delete button while a deletion is in flight. */
  isDeleting?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `AttachmentRow` — compact horizontal row showing one attachment.
 *
 * Layout (left → right):
 *   - MIME shortcode badge (e.g. "PDF", "PNG")
 *   - filename (truncated, title tooltip)
 *   - humanised file size (muted)
 *   - × delete button (icon-only, aria-label)
 */
export function AttachmentRow({
  attachment,
  onDelete,
  isDeleting = false,
  className,
}: AttachmentRowProps): ReactElement {
  return (
    <div
      className={cn(styles.row, className)}
      data-testid={`attachment-row-${attachment.id}`}
    >
      {/* MIME badge */}
      <span className={styles.mimeBadge} aria-label={`Type: ${attachment.mimeType}`}>
        {mimeTypeShortcode(attachment.mimeType)}
      </span>

      {/* Filename */}
      <span className={styles.filename} title={attachment.filename}>
        {attachment.filename}
      </span>

      {/* Size */}
      <span className={styles.size}>{formatBytes(attachment.sizeBytes)}</span>

      {/* Delete */}
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Delete attachment ${attachment.filename}`}
        isDisabled={isDeleting}
        isPending={isDeleting}
        onPress={() => onDelete?.(attachment.id)}
        className={styles.deleteButton}
        data-testid={`attachment-row-delete-${attachment.id}`}
      >
        ×
      </Button>
    </div>
  );
}
