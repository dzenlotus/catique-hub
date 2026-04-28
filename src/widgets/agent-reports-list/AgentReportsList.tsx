import type { ReactElement } from "react";

import {
  AgentReportCard,
  useAgentReports,
  useAgentReportsByTask,
} from "@entities/agent-report";
import { Button } from "@shared/ui";

import styles from "./AgentReportsList.module.css";

export interface AgentReportsListProps {
  /**
   * When provided (and non-empty), the list is filtered to reports
   * belonging to this task via `useAgentReportsByTask()`. When omitted
   * or empty, all reports are shown via `useAgentReports()`.
   */
  taskId?: string;
  /** Called when the user activates a report card. */
  onSelectReport?: (id: string) => void;
}

/**
 * `AgentReportsList` — widget that renders agent reports.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error — inline error panel + retry.
 *   3. empty — friendly headline.
 *   4. populated — vertical stack of `AgentReportCard`s.
 *
 * Uses two separate query hooks depending on whether `taskId` is set.
 * React rules-of-hooks are satisfied by always calling both hooks and
 * conditionally using the result of the relevant one based on `taskId`.
 * Both hooks are guarded by their own `enabled` flag so the inactive
 * one never fires an IPC call.
 */
export function AgentReportsList({
  taskId,
  onSelectReport,
}: AgentReportsListProps = {}): ReactElement {
  const filterByTask = taskId !== undefined && taskId.length > 0;

  // Both hooks must be called unconditionally (rules of hooks).
  // `useAgentReportsByTask` is disabled when `taskId` is empty/missing,
  // `useAgentReports` is the fallback.
  const allQuery = useAgentReports();
  const taskQuery = useAgentReportsByTask(taskId ?? "");

  const query = filterByTask ? taskQuery : allQuery;
  const emptyHint = filterByTask
    ? "No reports for this task yet."
    : "No agent reports yet.";

  function handleSelect(id: string): void {
    if (onSelectReport !== undefined) {
      onSelectReport(id);
      return;
    }
    // eslint-disable-next-line no-console
    console.info("[agent-reports-list] select report:", id);
  }

  return (
    <section
      className={styles.root}
      aria-labelledby="agent-reports-list-heading"
    >
      <header className={styles.header}>
        <h2 id="agent-reports-list-heading" className={styles.heading}>
          Agent Reports
        </h2>
      </header>

      {query.status === "pending" ? (
        <div className={styles.list} data-testid="agent-reports-list-loading">
          <AgentReportCard isPending />
          <AgentReportCard isPending />
          <AgentReportCard isPending />
        </div>
      ) : query.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Couldn&apos;t load reports: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void query.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : query.data.length === 0 ? (
        <div className={styles.empty} data-testid="agent-reports-list-empty">
          <p className={styles.emptyTitle}>No reports yet</p>
          <p className={styles.emptyHint}>{emptyHint}</p>
        </div>
      ) : (
        <div className={styles.list} data-testid="agent-reports-list-grid">
          {query.data.map((report) => (
            <AgentReportCard
              key={report.id}
              report={report}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}
