import { useEffect, useState, type ReactElement } from "react";

import { cn } from "@shared/lib";
import { Button, MarkdownPreview } from "@shared/ui";

import type { AgentReport } from "../../model/types";
import type { AgentReportKind } from "@bindings/AgentReportKind";

import styles from "./AgentReportCard.module.css";

/** Kind values from the Rust domain — used for colour-coded chips. */
const KIND_CLASS_MAP: Record<AgentReportKind, string> = {
  investigation: styles.kindInvestigation ?? "",
  plan: styles.kindPlan ?? "",
  summary: styles.kindSummary ?? "",
  review: styles.kindReview ?? "",
  approval: styles.kindApproval ?? "",
};

function kindClass(kind: string): string {
  return (KIND_CLASS_MAP as Record<string, string | undefined>)[kind] ?? "";
}

/**
 * Format an epoch-millisecond bigint as a human-readable relative time.
 *
 * Returns strings like "just now", "5 min ago", "3 hours ago",
 * "2 days ago", or a locale date string for older dates.
 */
export function formatRelativeTime(epochMillis: bigint): string {
  const now = Date.now();
  const diffMs = now - Number(epochMillis);

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(Number(epochMillis)).toLocaleDateString();
}

export interface AgentReportCardProps {
  /**
   * Report to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  report?: AgentReport;
  /** Click / keyboard-activate handler. Receives the report id. */
  onSelect?: (id: string) => void;
  /**
   * When `true`, the card becomes an in-place expand/collapse panel:
   * the header toggles a body that renders the report's full `content`
   * as Markdown. Use this in read contexts (task detail, Reports page)
   * where there's no separate "open report" destination. When set, the
   * click toggles the panel instead of firing `onSelect`.
   */
  expandable?: boolean;
  /**
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `useAgentReports()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
  /**
   * When provided, the expandable body shows a human review surface: an
   * "approved" checkbox and a correction-comment box. Omit in read-only
   * contexts (the card stays purely presentational then).
   */
  onToggleApproved?: (id: string, approved: boolean) => void;
  /** Persist the reviewer's correction comment. Paired with the body box. */
  onSaveComment?: (id: string, comment: string) => void;
}

/** Approval status pill for the header row. */
function ApprovalBadge({ report }: { report: AgentReport }): ReactElement | null {
  if (report.approved) {
    return (
      <span className={styles.approvedChip} aria-label="Approved">
        ✓ Approved
      </span>
    );
  }
  if (report.kind === "approval") {
    return (
      <span className={styles.needsApprovalChip} aria-label="Needs approval">
        Needs approval
      </span>
    );
  }
  return null;
}

/**
 * `AgentReportCard` — presentational card for a single AgentReport.
 *
 * Vertical layout:
 *   - top: `kind` chip + relative timestamp
 *   - middle: `title` (single line, truncated)
 *   - bottom: `content` preview (2-line clamp, muted)
 *
 * Native `<button>` for activation — gets focus, Enter, Space, and
 * platform a11y semantics for free.
 *
 * Reduced-motion: hover transitions are guarded in the module's
 * `@media (prefers-reduced-motion: reduce)` block.
 */
export function AgentReportCard({
  report,
  onSelect,
  expandable = false,
  isPending = false,
  className,
  onToggleApproved,
  onSaveComment,
}: AgentReportCardProps): ReactElement {
  // Always called (rules of hooks); only consulted in the expandable
  // branch.
  const [expanded, setExpanded] = useState(false);

  if (isPending || !report) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="agent-report-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
        <div className={cn(styles.skeletonLine, styles.skeletonTitle)} />
        <div className={cn(styles.skeletonLine, styles.skeletonContent)} />
      </div>
    );
  }

  // Expandable read panel: header toggles a Markdown body. Rendered as
  // a `<div>` wrapper with a header `<button>` (aria-expanded) and a
  // sibling body region — keeping the block-level Markdown OUT of the
  // button so the HTML stays valid and accessible.
  if (expandable) {
    return (
      <div
        className={cn(styles.card, className)}
        data-testid="agent-report-card"
      >
        <button
          type="button"
          className={styles.headerButton}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          data-testid="agent-report-card-toggle"
        >
          <span className={styles.topRow}>
            <span
              className={cn(styles.kindChip, kindClass(report.kind))}
              aria-label={`Kind: ${report.kind}`}
            >
              {report.kind}
            </span>
            <ApprovalBadge report={report} />
            <span className={styles.timestamp} aria-label="Created at">
              {formatRelativeTime(report.createdAt)}
            </span>
            <span
              className={cn(styles.chevron, expanded && styles.chevronExpanded)}
              aria-hidden="true"
            >
              ▸
            </span>
          </span>

          <span className={styles.title} title={report.title}>
            {report.title}
          </span>

          {!expanded ? (
            <span className={styles.contentPreview}>{report.content}</span>
          ) : null}
        </button>

        {expanded ? (
          <div className={styles.body} data-testid="agent-report-card-body">
            <MarkdownPreview source={report.content} />
            {onToggleApproved !== undefined || onSaveComment !== undefined ? (
              <ReviewControls
                report={report}
                onToggleApproved={onToggleApproved}
                onSaveComment={onSaveComment}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(report.id)}
    >
      <span className={styles.topRow}>
        <span
          className={cn(styles.kindChip, kindClass(report.kind))}
          aria-label={`Kind: ${report.kind}`}
        >
          {report.kind}
        </span>
        <ApprovalBadge report={report} />
        <span className={styles.timestamp} aria-label="Created at">
          {formatRelativeTime(report.createdAt)}
        </span>
      </span>

      <span className={styles.title} title={report.title}>
        {report.title}
      </span>

      <span className={styles.contentPreview}>{report.content}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ReviewControlsProps {
  report: AgentReport;
  onToggleApproved?: ((id: string, approved: boolean) => void) | undefined;
  onSaveComment?: ((id: string, comment: string) => void) | undefined;
}

/**
 * Human review surface shown inside the expanded body: an "approved"
 * checkbox (the person ticks it once they've looked) and a correction
 * comment the agent should act on. Both persist via the callbacks the
 * widget wires to `useUpdateAgentReportMutation`.
 */
function ReviewControls({
  report,
  onToggleApproved,
  onSaveComment,
}: ReviewControlsProps): ReactElement {
  const [comment, setComment] = useState(report.reviewComment ?? "");

  // Re-sync when the saved comment changes (e.g. realtime refresh).
  useEffect(() => {
    setComment(report.reviewComment ?? "");
  }, [report.reviewComment]);

  const commentDirty = comment !== (report.reviewComment ?? "");

  return (
    <div className={styles.review} data-testid="agent-report-card-review">
      {onToggleApproved !== undefined ? (
        <label className={styles.reviewCheck}>
          <input
            type="checkbox"
            checked={report.approved}
            onChange={(e) => onToggleApproved(report.id, e.target.checked)}
            data-testid="agent-report-card-approved"
          />
          Reviewed &amp; approved
        </label>
      ) : null}

      {onSaveComment !== undefined ? (
        <>
          <textarea
            className={styles.reviewTextarea}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Leave corrections for the agent to address…"
            aria-label="Review comment"
            data-testid="agent-report-card-comment"
          />
          <div className={styles.reviewActions}>
            <Button
              variant="secondary"
              size="sm"
              isDisabled={!commentDirty}
              onPress={() => onSaveComment(report.id, comment)}
              data-testid="agent-report-card-comment-save"
            >
              Save comment
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
