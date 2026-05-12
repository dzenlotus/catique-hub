/**
 * ConnectedAgentsSection — round-21 unit tests.
 *
 * Mocks `@shared/api` so the IPCs (`list_connected_providers`,
 * `list_supported_providers`, `add_provider`, `remove_provider`,
 * `get_sync_status`) don't reach Tauri.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

import { invoke } from "@shared/api";
import { ToastProvider } from "@app/providers/ToastProvider";
import { ConnectedAgentsSection } from "./ConnectedAgentsSection";

const invokeMock = vi.mocked(invoke);

interface ProviderStub {
  id: string;
  displayName: string;
  configDir: string;
  signatureFile: string;
  installed: boolean;
  enabled: boolean;
  lastSeenAt: bigint;
  supportsRoleSync: boolean;
}

function makeProvider(overrides: Partial<ProviderStub> = {}): ProviderStub {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    configDir: "/Users/test/.claude",
    signatureFile: "/Users/test/.claude/settings.json",
    installed: true,
    enabled: true,
    lastSeenAt: 0n,
    supportsRoleSync: true,
    ...overrides,
  };
}

function setup(): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConnectedAgentsSection />
      </ToastProvider>
    </QueryClientProvider>
  );
  render(ui);
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConnectedAgentsSection (round-21)", () => {
  it("renders the Add provider trigger", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") return Promise.resolve([]);
      if (cmd === "get_sync_status") return Promise.resolve({ state: "idle" });
      return Promise.resolve(undefined);
    });
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("connected-agents-add-provider"),
      ).toBeInTheDocument();
    });
  });

  it("shows the empty state when no providers are connected", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") return Promise.resolve([]);
      if (cmd === "get_sync_status") return Promise.resolve({ state: "idle" });
      return Promise.resolve(undefined);
    });
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("connected-agents-empty"),
      ).toBeInTheDocument();
    });
  });

  it("renders a row per connected provider with name + sync pill + Remove", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") {
        return Promise.resolve([
          makeProvider({ id: "claude-code", displayName: "Claude Code" }),
          makeProvider({ id: "cursor", displayName: "Cursor" }),
        ]);
      }
      if (cmd === "get_sync_status") return Promise.resolve({ state: "idle" });
      return Promise.resolve(undefined);
    });
    setup();
    await waitFor(() => {
      expect(screen.getByTestId("connected-agents-list")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("connected-agents-row-claude-code"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("connected-agents-row-cursor"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("connected-agents-row-remove-claude-code"),
    ).toBeInTheDocument();
  });

  it("hides providers whose enabled flag is false", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") {
        return Promise.resolve([
          makeProvider({ id: "claude-code", enabled: true }),
          makeProvider({ id: "cline", enabled: false }),
        ]);
      }
      if (cmd === "get_sync_status") return Promise.resolve({ state: "idle" });
      return Promise.resolve(undefined);
    });
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("connected-agents-row-claude-code"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("connected-agents-row-cline"),
    ).not.toBeInTheDocument();
  });

  it("shows Syncing… in row pill when sync state is syncing", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") {
        return Promise.resolve([makeProvider()]);
      }
      if (cmd === "get_sync_status") {
        return Promise.resolve({ state: "syncing" });
      }
      return Promise.resolve(undefined);
    });
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("connected-agents-row-sync-claude-code"),
      ).toHaveTextContent("Syncing…");
    });
  });

  it("shows Sync error pill for the failing provider id", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") {
        return Promise.resolve([
          makeProvider({ id: "claude-code" }),
          makeProvider({ id: "cursor", displayName: "Cursor" }),
        ]);
      }
      if (cmd === "get_sync_status") {
        return Promise.resolve({
          state: "error",
          failingProviders: ["cursor"],
        });
      }
      return Promise.resolve(undefined);
    });
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("connected-agents-row-sync-cursor"),
      ).toHaveTextContent("Sync error");
    });
    // The unaffected row stays Synced.
    expect(
      screen.getByTestId("connected-agents-row-sync-claude-code"),
    ).toHaveTextContent("Synced");
  });

  it("calls remove_provider when the Remove button is pressed", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") {
        return Promise.resolve([makeProvider()]);
      }
      if (cmd === "get_sync_status") return Promise.resolve({ state: "idle" });
      if (cmd === "remove_provider") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    setup();
    const button = await screen.findByTestId(
      "connected-agents-row-remove-claude-code",
    );
    await userEvent.click(button);
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "remove_provider",
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.[1]).toMatchObject({ providerId: "claude-code" });
    });
  });

  it("shows error message when the connected list query fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") {
        return Promise.reject(new Error("IPC unavailable"));
      }
      if (cmd === "get_sync_status") return Promise.resolve({ state: "idle" });
      return Promise.resolve(undefined);
    });
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("connected-agents-error"),
      ).toBeInTheDocument();
    });
  });

  it("opens the AddProviderDialog when Add provider is pressed", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connected_providers") return Promise.resolve([]);
      if (cmd === "get_sync_status") return Promise.resolve({ state: "idle" });
      if (cmd === "list_supported_providers") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    setup();
    const trigger = await screen.findByTestId("connected-agents-add-provider");
    await userEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByTestId("add-provider-dialog")).toBeInTheDocument();
    });
  });
});
