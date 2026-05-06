import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// Mock @shared/api so IPC calls don't fail in unit tests.
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
import { ConnectedAgentsSection } from "./ConnectedAgentsSection";

const invokeMock = vi.mocked(invoke);

function setup(): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ConnectedAgentsSection />
    </QueryClientProvider>
  );
  render(ui);
}

describe("ConnectedAgentsSection", () => {
  it("renders the discover button", async () => {
    invokeMock.mockResolvedValue([]);
    setup();
    await waitFor(() => {
      expect(screen.getByTestId("discover-clients-button")).toBeInTheDocument();
    });
  });

  it("shows empty state when no clients are returned", async () => {
    invokeMock.mockResolvedValue([]);
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("connected-agents-empty"),
      ).toBeInTheDocument();
    });
  });

  it("renders client cards when clients are present", async () => {
    invokeMock.mockResolvedValue([
      {
        id: "claude-code",
        displayName: "Claude Code",
        configDir: "/Users/test/.claude",
        signatureFile: "/Users/test/.claude/settings.json",
        installed: true,
        enabled: true,
        lastSeenAt: BigInt(0),
      },
    ]);
    setup();
    await waitFor(() => {
      expect(screen.getByTestId("connected-agents-grid")).toBeInTheDocument();
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
    });
  });

  it("shows error message when query fails", async () => {
    invokeMock.mockRejectedValue(new Error("IPC unavailable"));
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("connected-agents-error"),
      ).toBeInTheDocument();
    });
  });

  it("calls discover_clients IPC when button is pressed", async () => {
    invokeMock.mockResolvedValue([]);
    setup();
    await waitFor(() => screen.getByTestId("discover-clients-button"));

    // Reset and set up discover response.
    invokeMock.mockResolvedValue([]);
    await userEvent.click(screen.getByTestId("discover-clients-button"));
    // audit-#17: API uses `invokeWithAppError(command)` without an args
    // object so the recorded call is `["discover_clients"]` — assert by
    // command name to stay agnostic of trailing arg-shape.
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "discover_clients",
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});
