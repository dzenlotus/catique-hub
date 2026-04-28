/**
 * FirstLaunchGate — branching tests.
 *
 * The gate makes one or two IPC calls (`list_spaces`, optionally
 * `detect_promptery_db`) and decides what to render. We mock the
 * IPC layer at `@shared/api` and validate the four states.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { PrompteryDbInfo } from "@bindings/PrompteryDbInfo";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
  on: vi.fn(async () => () => undefined),
}));

import { invoke } from "@shared/api";
import { FirstLaunchGate } from "./FirstLaunchGate";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement): { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client };
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

beforeEach(() => {
  invokeMock.mockReset();
});

describe("FirstLaunchGate", () => {
  it("renders children when the DB already has spaces (returning user)", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_spaces") return [{ id: "spc-1", name: "default" }];
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(
      <FirstLaunchGate>
        <div data-testid="real-app">Hello</div>
      </FirstLaunchGate>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("real-app")).toBeInTheDocument();
    });
    // Gate must NOT have rendered the wizard or welcome screen.
    expect(screen.queryByTestId("import-wizard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("welcome-widget")).not.toBeInTheDocument();
  });

  it("renders the ImportWizard when first-launch + Promptery DB detected", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_spaces") return [];
      if (cmd === "detect_promptery_db") return makeDbInfo();
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(
      <FirstLaunchGate>
        <div data-testid="real-app">Hello</div>
      </FirstLaunchGate>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-wizard")).toBeInTheDocument();
    });
    expect(screen.getByTestId("import-stage-detection")).toBeInTheDocument();
    // Children stay mounted-but-hidden so they're queryable but their
    // wrapper has aria-hidden="true". Real-app is in the DOM either way.
    expect(screen.getByTestId("real-app")).toBeInTheDocument();
  });

  it("renders the WelcomeWidget when first-launch + no Promptery DB", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_spaces") return [];
      if (cmd === "detect_promptery_db") return null;
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(
      <FirstLaunchGate>
        <div data-testid="real-app">Hello</div>
      </FirstLaunchGate>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("welcome-widget")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("import-wizard")).not.toBeInTheDocument();
  });

  it("renders a loading shell while the spaces query is pending", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves

    renderWithClient(
      <FirstLaunchGate>
        <div data-testid="real-app">Hello</div>
      </FirstLaunchGate>,
    );

    // The spinner shell exists; children are not yet rendered as the
    // primary content (the loading panel is what the user sees).
    expect(
      screen.getByText(/Загрузка Catique HUB/i),
    ).toBeInTheDocument();
  });

  it("bypass=true short-circuits all IPC and renders children directly", () => {
    renderWithClient(
      <FirstLaunchGate bypass>
        <div data-testid="real-app">Hello</div>
      </FirstLaunchGate>,
    );
    expect(screen.getByTestId("real-app")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
