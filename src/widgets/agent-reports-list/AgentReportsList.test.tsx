import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { AgentReport } from "@entities/agent-report";

// Mock the Tauri invoke wrapper at the shared/api boundary — this is
// the single place IPC traffic crosses, so all four states (loading,
// error, empty, populated) can be driven from here.
vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invoke } from "@shared/api";
import { AgentReportsList } from "./AgentReportsList";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement): {
  client: QueryClient;
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
  return { client, user };
}

function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
  return {
    id: "report-1",
    taskId: "task-abc",
    kind: "investigation",
    title: "Findings on issue #42",
    content: "Discovered a race condition in the auth flow.",
    author: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentReportsList (all reports)", () => {
  it("renders 3 skeleton cards while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<AgentReportsList />);
    const skeletons = screen.getAllByTestId("agent-report-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("renders the loading container testid while pending", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<AgentReportsList />);
    expect(
      screen.getByTestId("agent-reports-list-loading"),
    ).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", async () => {
    invokeMock.mockResolvedValue([] satisfies AgentReport[]);
    renderWithClient(<AgentReportsList />);
    await waitFor(() => {
      expect(
        screen.getByTestId("agent-reports-list-empty"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/no reports yet/i)).toBeInTheDocument();
  });

  it("renders one AgentReportCard per report when populated", async () => {
    invokeMock.mockResolvedValue([
      makeReport({ id: "r-1", title: "Report Alpha" }),
      makeReport({ id: "r-2", title: "Report Beta" }),
      makeReport({ id: "r-3", title: "Report Gamma" }),
    ] satisfies AgentReport[]);
    renderWithClient(<AgentReportsList />);
    await waitFor(() => {
      expect(
        screen.getByTestId("agent-reports-list-grid"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Report Alpha")).toBeInTheDocument();
    expect(screen.getByText("Report Beta")).toBeInTheDocument();
    expect(screen.getByText("Report Gamma")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    invokeMock.mockRejectedValue(new Error("transport down"));
    renderWithClient(<AgentReportsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry/i }),
    ).toBeInTheDocument();
  });

  it("calls onSelectReport with the report id when a card is activated", async () => {
    invokeMock.mockResolvedValue([
      makeReport({ id: "report-pick", title: "Pick me" }),
    ] satisfies AgentReport[]);
    const onSelectReport = vi.fn();
    const { user } = renderWithClient(
      <AgentReportsList onSelectReport={onSelectReport} />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("agent-reports-list-grid"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByText("Pick me"));
    expect(onSelectReport).toHaveBeenCalledWith("report-pick");
  });
});

describe("AgentReportsList (filter by task)", () => {
  it("renders skeleton cards while loading for a task", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<AgentReportsList taskId="task-xyz" />);
    const skeletons = screen.getAllByTestId("agent-report-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("shows only reports matching the taskId", async () => {
    invokeMock.mockResolvedValue([
      makeReport({ id: "r-match-1", taskId: "task-xyz", title: "Matching" }),
      makeReport({ id: "r-other", taskId: "task-other", title: "Other task" }),
    ] satisfies AgentReport[]);
    renderWithClient(<AgentReportsList taskId="task-xyz" />);
    await waitFor(() => {
      expect(
        screen.getByTestId("agent-reports-list-grid"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Matching")).toBeInTheDocument();
    expect(screen.queryByText("Other task")).not.toBeInTheDocument();
  });

  it("shows empty state when no reports match the taskId", async () => {
    invokeMock.mockResolvedValue([
      makeReport({ id: "r-other", taskId: "task-other", title: "Other" }),
    ] satisfies AgentReport[]);
    renderWithClient(<AgentReportsList taskId="task-xyz" />);
    await waitFor(() => {
      expect(
        screen.getByTestId("agent-reports-list-empty"),
      ).toBeInTheDocument();
    });
  });

  it("shows all reports when taskId is empty string (falls back to all)", async () => {
    invokeMock.mockResolvedValue([
      makeReport({ id: "r-1", title: "All Reports View" }),
    ] satisfies AgentReport[]);
    renderWithClient(<AgentReportsList taskId="" />);
    await waitFor(() => {
      expect(
        screen.getByTestId("agent-reports-list-grid"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("All Reports View")).toBeInTheDocument();
  });
});
