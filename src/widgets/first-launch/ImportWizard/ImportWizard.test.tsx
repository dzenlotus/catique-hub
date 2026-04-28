/**
 * ImportWizard tests.
 *
 * The wizard's stage transitions are driven by IPC results + user
 * input. We mock `@shared/api` so each test can drive the flow.
 *
 * The five tests cover:
 *   1. DetectionStage renders the source DB info and disables continue
 *      when the schema doesn't match.
 *   2. Detection → Preview → Running navigation succeeds when the
 *      dry-run completes cleanly.
 *   3. PreviewStage shows the failure banner when the dry-run rejects.
 *   4. Running → Completed: real-import resolves and the report
 *      summary surfaces.
 *   5. Running → Failed: real-import rejects and the failure stage
 *      surfaces with the right kind/message.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { ImportReport } from "@bindings/ImportReport";
import type { PreflightResults } from "@bindings/PreflightResults";
import type { PrompteryDbInfo } from "@bindings/PrompteryDbInfo";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
  on: vi.fn(async () => () => undefined),
}));

import { invoke } from "@shared/api";
import { ImportWizard } from "./ImportWizard";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { user };
}

function makeDbInfo(overrides: Partial<PrompteryDbInfo> = {}): PrompteryDbInfo {
  return {
    path: "/Users/me/.promptery/db.sqlite",
    sizeBytes: 4_096n,
    schemaHash: "deadbeefcafe",
    tasksCount: 17n,
    lastModifiedMs: 1_700_000_000_000n,
    ...overrides,
  };
}

function makePreflight(allOk: boolean): PreflightResults {
  return {
    pf1SourceExists: allOk,
    pf2IntegrityOk: allOk,
    pf3QuickCheckOk: allOk,
    pf4SchemaHashOk: allOk,
    pf5TargetWritable: allOk,
    pf6DiskSpaceOk: allOk,
    pf7SourceLockOk: allOk,
    pf8ForeignKeysOn: allOk,
    pf9TargetEmptyOrOverwrite: allOk,
    pf10AttachmentsReadable: allOk,
    messages: {},
  };
}

function makeReport(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    startedAtMs: 1_700_000_000_000n,
    finishedAtMs: 1_700_000_001_500n,
    durationMs: 1_500n,
    sourcePath: "/Users/me/.promptery/db.sqlite",
    sourceSizeBytes: 4_096n,
    sourceSchemaHash: "deadbeefcafe",
    targetSchemaHash: "deadbeefcafe",
    schemaMatch: true,
    preflight: makePreflight(true),
    rowsImported: {
      spaces: 2n,
      boards: 5n,
      tasks: 88n,
      prompts: 14n,
    },
    ftsRowsRebuilt: { tasks_fts: 88n, agent_reports_fts: 12n },
    attachmentsCopied: 3n,
    attachmentsTotalBytes: 102_400n,
    dryRun: false,
    commitPath: "/data/catique/db.sqlite",
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("ImportWizard", () => {
  it("DetectionStage renders DB info; schema mismatch disables Continue", () => {
    const onCompleted = vi.fn();
    const onSkipped = vi.fn();
    renderWithClient(
      <ImportWizard
        detected={makeDbInfo({ schemaHash: "" })} // empty hash → drift
        onCompleted={onCompleted}
        onSkipped={onSkipped}
        initialStage="detection"
      />,
    );

    expect(screen.getByTestId("import-stage-detection")).toBeInTheDocument();
    expect(
      screen.getByText("/Users/me/.promptery/db.sqlite"),
    ).toBeInTheDocument();
    const continueBtn = screen.getByTestId("detection-continue");
    expect(continueBtn).toBeDisabled();
  });

  it("navigates Detection → Preview → Running when the dry-run succeeds", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "import_from_promptery") return makeReport({ dryRun: true });
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <ImportWizard
        detected={makeDbInfo()}
        onCompleted={vi.fn()}
        onSkipped={vi.fn()}
      />,
    );

    // Detection → Preview.
    await user.click(screen.getByTestId("detection-continue"));
    await waitFor(() => {
      expect(screen.getByTestId("import-stage-preview")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("preview-confirm")).not.toBeDisabled();
    });

    // Preview → Running. The real-import will hang (no resolution
    // queued), which is what the user-flow looks like in production
    // before the final report arrives.
    invokeMock.mockImplementation(() => new Promise(() => {})); // hang real
    await user.click(screen.getByTestId("preview-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("import-stage-running")).toBeInTheDocument();
    });
    expect(screen.getByTestId("import-progress-bar")).toBeInTheDocument();
  });

  it("PreviewStage surfaces a failure banner when the dry-run rejects", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "import_from_promptery") {
        throw new Error("disk full");
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(
      <ImportWizard
        detected={makeDbInfo()}
        onCompleted={vi.fn()}
        onSkipped={vi.fn()}
        initialStage="preview"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/disk full/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("preview-confirm")).toBeDisabled();
  });

  it("Running → Completed: real-import resolves and report renders", async () => {
    const finalReport = makeReport({
      durationMs: 2_000n,
      rowsImported: {
        spaces: 1n,
        boards: 3n,
        tasks: 42n,
        prompts: 8n,
      },
    });
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "import_from_promptery") {
        const opts = (args ?? {}) as { options?: { dryRun?: boolean } };
        if (opts.options?.dryRun) return makeReport({ dryRun: true });
        return finalReport;
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    const onCompleted = vi.fn();
    const { user } = renderWithClient(
      <ImportWizard
        detected={makeDbInfo()}
        onCompleted={onCompleted}
        onSkipped={vi.fn()}
        initialStage="preview"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preview-confirm")).not.toBeDisabled();
    });
    await user.click(screen.getByTestId("preview-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("import-stage-completed")).toBeInTheDocument();
    });
    expect(screen.getByText(/2 000/)).toBeInTheDocument(); // ru-RU thousands sep
    expect(screen.getByTestId("completed-open-kanban")).toBeInTheDocument();

    await user.click(screen.getByTestId("completed-open-kanban"));
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("Running → Failed: real-import rejects and FailedStage surfaces the kind", async () => {
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "import_from_promptery") {
        const opts = (args ?? {}) as { options?: { dryRun?: boolean } };
        if (opts.options?.dryRun) return makeReport({ dryRun: true });
        // Reject with an AppError-shaped object so the wizard's
        // discrimination logic kicks in.
        throw {
          kind: "transactionRolledBack",
          data: { reason: "preflight failed" },
        };
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <ImportWizard
        detected={makeDbInfo()}
        onCompleted={vi.fn()}
        onSkipped={vi.fn()}
        initialStage="preview"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preview-confirm")).not.toBeDisabled();
    });
    await user.click(screen.getByTestId("preview-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("import-stage-failed")).toBeInTheDocument();
    });
    expect(screen.getByText(/transactionRolledBack/)).toBeInTheDocument();
    expect(screen.getByText(/preflight failed/)).toBeInTheDocument();
    expect(screen.getByTestId("failed-retry")).toBeInTheDocument();
  });
});
