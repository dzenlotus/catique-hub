import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { AgentReport } from "../../model/types";

import styles from "./AgentReportCard.module.css";

/** Kind values from the Rust domain — used for colour-coded chips. */
type KnownKind = "investigation" | "review" | "memo" | "summary" | "debug";

const KIND_CLASS_MAP: Record<KnownKind, string> = {
  investigation: styles.kindInvestigation ?? "",
  review: styles.kindReview ?? "",
  memo: styles.kindMemo ?? "",
  summary: styles.kindSummary ?? "",
  debug: styles.kindDebug ?? "",
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
   * Loading-state variant. Renders a static skeleton with no
   * interactivity. Useful while `useAgentReports()` is `pending`.
   */
  isPending?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
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
  isPending = false,
  className,
}: AgentReportCardProps): ReactElement {
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
