/**
 * TaskView — unit tests for the routed task editor (Task B7 layout).
 *
 * The "Run agent" button was removed (the run_task_agent IPC was never
 * shipped and the affordance confused users), so these tests verify the
 * current surface: the back button, the 2-column form + preview layout,
 * and the absence of the old run/status affordances.
 *
 * Provider chain: QueryClient > Toast > (no router — useParamsCompat is
 * mocked so the real TanStack Router is not needed).
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

// Mock useParamsCompat to inject taskId without a real router.
vi.mock("@shared/lib", async () => {
  const actual = await vi.importActual<typeof import("@shared/lib")>(
    "@shared/lib",
  );
  return {
    ...actual,
    useParamsCompat: vi.fn(() => ({ taskId: "tsk-abc" })),
    useLocationCompat: vi.fn(() => ["/tasks/tsk-abc", vi.fn()]),
  };
});

vi.mock("@shared/api", async () => {
  const actual =
    await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
    on: vi.fn(() => Promise.resolve(() => {})),
  };
});

// TaskDialogContent + the XML preview need heavy data — stub them out.
vi.mock("@features/task/dialog", () => ({
  TaskDialogContent: () => <div data-testid="task-dialog-stub" />,
}));

vi.mock("@widgets/effective-context-panel", () => ({
  TaskXmlPreview: () => <div data-testid="task-xml-preview-stub" />,
}));

import { useParamsCompat } from "@shared/lib";
import { ToastProvider } from "@shared/lib";
import { TaskView } from "../TaskView";

const useParamsCompatMock = vi.mocked(useParamsCompat);

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function setup(taskId: string): void {
  useParamsCompatMock.mockReturnValue({ taskId });
  const client = makeClient();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }

  render(
    <Wrapper>
      <TaskView />
    </Wrapper>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskView", () => {
  it("renders the back button", () => {
    setup("tsk-abc");
    expect(screen.getByTestId("task-view-back")).toBeInTheDocument();
  });

  it("renders the 2-column form + preview layout", () => {
    setup("tsk-abc");
    expect(screen.getByTestId("task-view-form-column")).toBeInTheDocument();
    expect(screen.getByTestId("task-view-preview")).toBeInTheDocument();
    expect(screen.getByTestId("task-dialog-stub")).toBeInTheDocument();
  });

  it("no longer renders the Run agent button or run status (feature removed)", () => {
    setup("tsk-abc");
    expect(
      screen.queryByTestId("task-view-run-agent"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-view-status")).not.toBeInTheDocument();
  });
});
