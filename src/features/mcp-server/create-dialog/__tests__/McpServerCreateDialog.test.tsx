/**
 * Unit tests for `<McpServerCreateDialog>` (PROXY-S6 / ADR-0008).
 *
 * Strategy mirrors `McpToolCreateDialog.test.tsx`:
 *   - Mock the IPC boundary via `vi.mock("@shared/api")`.
 *   - `pushToast` from the `ToastProvider` is captured via the
 *     `<ToastProvider>` wrapper plus a render-time spy installed
 *     through a tiny consumer.
 *   - Each transport variant produces a payload of the right shape.
 *
 * Bigint timestamps from the wire are mirrored here as `0n` placeholders
 * — Vitest's `expect.objectContaining` matches them structurally.
 */

import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { McpServer } from "@bindings/McpServer";
import type { McpServerStatus } from "@bindings/McpServerStatus";

vi.mock("@shared/api", async () => {
  const actual =
    await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invoke } from "@shared/api";
import { ToastProvider } from "@app/providers/ToastProvider";
import { McpServerCreateDialog } from "../McpServerCreateDialog";

const invokeMock = vi.mocked(invoke);

function renderWithProviders(ui: ReactElement): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { user };
}

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "srv-1",
    name: "Atlassian",
    transport: "http",
    url: "https://example.com/mcp",
    command: null,
    authJson: null,
    enabled: true,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makeStatus(overrides: Partial<McpServerStatus> = {}): McpServerStatus {
  return {
    serverId: "srv-1",
    state: "healthy",
    lastSyncedAt: 0n,
    toolCount: 3n,
    lastCallStartedAt: null,
    lastCallSuccess: null,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  // Some tests opt into fake timers locally; safety net here.
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("McpServerCreateDialog", () => {
  it("renders name input + transport radio group when open", () => {
    renderWithProviders(
      <McpServerCreateDialog isOpen onClose={() => undefined} />,
    );
    expect(
      screen.getByTestId("mcp-server-create-dialog-name-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mcp-server-create-dialog-transport-group"),
    ).toBeInTheDocument();
  });

  it("Save button is disabled until name and address are filled", async () => {
    const { user } = renderWithProviders(
      <McpServerCreateDialog isOpen onClose={() => undefined} />,
    );
    expect(
      screen.getByTestId("mcp-server-create-dialog-save"),
    ).toBeDisabled();

    await user.type(
      screen.getByTestId("mcp-server-create-dialog-name-input"),
      "Atlassian",
    );
    // Default transport = stdio → command field shown.
    expect(
      screen.getByTestId("mcp-server-create-dialog-save"),
    ).toBeDisabled();

    await user.type(
      screen.getByTestId("mcp-server-create-dialog-command-input"),
      "/usr/local/bin/foo",
    );
    expect(
      screen.getByTestId("mcp-server-create-dialog-save"),
    ).not.toBeDisabled();
  });

  it("submits stdio payload with command + null url + null authJson", async () => {
    const server = makeServer({ transport: "stdio", url: null, command: "/usr/local/bin/foo" });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "create_mcp_server") return Promise.resolve(server);
      if (cmd === "get_mcp_server_status") return Promise.resolve(makeStatus());
      return Promise.reject(new Error(`unmocked ${cmd}`));
    });

    const { user } = renderWithProviders(
      <McpServerCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("mcp-server-create-dialog-name-input"),
      "Atlassian",
    );
    await user.type(
      screen.getByTestId("mcp-server-create-dialog-command-input"),
      "/usr/local/bin/foo",
    );
    await user.click(screen.getByTestId("mcp-server-create-dialog-save"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "create_mcp_server",
      );
      expect(call?.[1]).toEqual({
        name: "Atlassian",
        transport: "stdio",
        url: null,
        command: "/usr/local/bin/foo",
        authJson: null,
        enabled: true,
      });
    });
  });

  it("submits http payload with url + null command", async () => {
    const server = makeServer();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "create_mcp_server") return Promise.resolve(server);
      if (cmd === "get_mcp_server_status") return Promise.resolve(makeStatus());
      return Promise.reject(new Error(`unmocked ${cmd}`));
    });

    const { user } = renderWithProviders(
      <McpServerCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("mcp-server-create-dialog-name-input"),
      "Atlassian",
    );
    await user.click(
      screen.getByTestId("mcp-server-create-dialog-transport-http"),
    );
    await user.type(
      screen.getByTestId("mcp-server-create-dialog-url-input"),
      "https://example.com/mcp",
    );
    await user.click(screen.getByTestId("mcp-server-create-dialog-save"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "create_mcp_server",
      );
      expect(call?.[1]).toEqual({
        name: "Atlassian",
        transport: "http",
        url: "https://example.com/mcp",
        command: null,
        authJson: null,
        enabled: true,
      });
    });
  });

  it("closes the dialog immediately after a successful create and fires onCreated after the status poll", async () => {
    const server = makeServer();
    const status = makeStatus({ state: "healthy", toolCount: 5n });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "create_mcp_server") return Promise.resolve(server);
      if (cmd === "get_mcp_server_status") return Promise.resolve(status);
      return Promise.reject(new Error(`unmocked ${cmd}`));
    });

    const onClose = vi.fn();
    const onCreated = vi.fn();
    const { user } = renderWithProviders(
      <McpServerCreateDialog
        isOpen
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    await user.type(
      screen.getByTestId("mcp-server-create-dialog-name-input"),
      "Atlassian",
    );
    await user.click(
      screen.getByTestId("mcp-server-create-dialog-transport-http"),
    );
    await user.type(
      screen.getByTestId("mcp-server-create-dialog-url-input"),
      "https://example.com/mcp",
    );
    await user.click(screen.getByTestId("mcp-server-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    // The status-poll runs inside a 1 s `setTimeout`. We allow real time
    // here (tests opt out of fake timers by default — see beforeEach
    // shape). 1.5 s is comfortably above the 1 s wait but still fast
    // enough not to slow the suite meaningfully.
    await waitFor(
      () => {
        expect(onCreated).toHaveBeenCalledWith(server);
      },
      { timeout: 3_000 },
    );
  });
});
