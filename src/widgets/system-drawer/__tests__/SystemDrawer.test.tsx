/**
 * SystemDrawer — Start / Stop / Restart wiring (Stream Q, Round 4).
 *
 * Verifies the three sidecar lifecycle buttons:
 *
 *   - Start is disabled when the sidecar is already running.
 *   - Stop is enabled when running, disabled when stopped/crashed.
 *   - Pressing each button dispatches the matching `sidecar_*` IPC.
 *
 * Done with mocked `useSidecarStatus` + mocked `invoke` so the test
 * stays fully synchronous after the initial render.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const sidecarState = {
  current: { state: "running", pid: 1 } as
    | { state: "running"; pid: number }
    | { state: "stopped" }
    | { state: "starting" }
    | { state: "crashed"; exitCode: number | null },
};

vi.mock("@shared/lib", async () => {
  const actual = await vi.importActual<typeof import("@shared/lib")>(
    "@shared/lib",
  );
  return {
    ...actual,
    useSidecarStatus: () => sidecarState.current,
    refreshSidecarStatus: vi.fn().mockResolvedValue({ state: "running", pid: 1 }),
  };
});

import { invoke } from "@shared/api";
import { SystemDrawer } from "../SystemDrawer";

const invokeMock = vi.mocked(invoke);

function renderDrawer(): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  // Seed the connected-clients query so the drawer doesn't issue an
  // unhandled IPC during the test.
  client.setQueryData(["connected_clients"], []);
  const user = userEvent.setup();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <SystemDrawer open onClose={() => {}} />
    </QueryClientProvider>
  );
  render(ui);
  return { user };
}

describe("SystemDrawer — sidecar Start/Stop/Restart", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_connected_providers") return [];
      return null;
    });
    sidecarState.current = { state: "running", pid: 1 };
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it("renders Start disabled and Stop enabled when running", () => {
    renderDrawer();
    const start = screen.getByTestId("system-drawer-sidecar-start");
    const stop = screen.getByTestId("system-drawer-sidecar-stop");
    const restart = screen.getByTestId("system-drawer-sidecar-restart");
    expect(start).toBeDisabled();
    expect(stop).not.toBeDisabled();
    expect(restart).not.toBeDisabled();
  });

  it("renders Start enabled and Stop disabled when stopped", () => {
    sidecarState.current = { state: "stopped" };
    renderDrawer();
    expect(screen.getByTestId("system-drawer-sidecar-start")).not.toBeDisabled();
    expect(screen.getByTestId("system-drawer-sidecar-stop")).toBeDisabled();
  });

  it("renders Stop disabled when crashed (nothing to stop)", () => {
    sidecarState.current = { state: "crashed", exitCode: 1 };
    renderDrawer();
    expect(screen.getByTestId("system-drawer-sidecar-stop")).toBeDisabled();
    // Start is offered as the recovery action.
    expect(screen.getByTestId("system-drawer-sidecar-start")).not.toBeDisabled();
  });

  it("invokes sidecar_stop when Stop is pressed", async () => {
    const { user } = renderDrawer();
    await user.click(screen.getByTestId("system-drawer-sidecar-stop"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("sidecar_stop");
    });
  });

  it("invokes sidecar_start when Start is pressed (from stopped)", async () => {
    sidecarState.current = { state: "stopped" };
    const { user } = renderDrawer();
    await user.click(screen.getByTestId("system-drawer-sidecar-start"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("sidecar_start");
    });
  });

  it("no longer renders the legacy 'Start / Stop ship with' footnote", () => {
    renderDrawer();
    expect(screen.queryByText(/only Restart is wired/i)).not.toBeInTheDocument();
  });
});
