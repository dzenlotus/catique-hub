/**
 * SyncIndicator — unit tests.
 *
 * Mocks `@shared/api` so `get_sync_status` doesn't reach Tauri. Drives
 * the various states by seeding `connectedClientsKeys.syncStatus()` in
 * the QueryClient cache directly.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>(
    "@shared/api",
  );
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invoke } from "@shared/api";
import {
  connectedClientsKeys,
  type SyncStatus,
} from "@entities/connected-client";
import { SyncIndicator } from "../SyncIndicator";

const invokeMock = vi.mocked(invoke);

function renderWithStatus(status: SyncStatus | undefined): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  if (status !== undefined) {
    client.setQueryData(connectedClientsKeys.syncStatus(), status);
  }
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <SyncIndicator />
    </QueryClientProvider>
  );
  render(ui);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SyncIndicator", () => {
  it("renders nothing when state is idle", () => {
    renderWithStatus({ state: "idle" });
    expect(
      screen.queryByTestId("top-bar-sync-indicator"),
    ).not.toBeInTheDocument();
  });

  it("renders Syncing… while the sync is in flight", () => {
    renderWithStatus({ state: "syncing" });
    const host = screen.getByTestId("top-bar-sync-indicator");
    expect(host).toHaveTextContent("Syncing…");
  });

  it("renders Sync error pill on error state", () => {
    renderWithStatus({ state: "error", failingProviders: ["cursor"] });
    const host = screen.getByTestId("top-bar-sync-indicator");
    expect(host).toHaveTextContent("Sync error");
  });

  it("shows the failing-provider tooltip on hover", async () => {
    renderWithStatus({
      state: "error",
      failingProviders: ["cursor", "cline"],
    });
    const host = screen.getByTestId("top-bar-sync-indicator");
    await userEvent.hover(host);
    const tooltip = screen.getByTestId("top-bar-sync-indicator-tooltip");
    expect(tooltip).toHaveTextContent("Failing providers: cursor, cline");
  });

  it("falls silent when the query has no data yet", () => {
    renderWithStatus(undefined);
    expect(
      screen.queryByTestId("top-bar-sync-indicator"),
    ).not.toBeInTheDocument();
  });
});
