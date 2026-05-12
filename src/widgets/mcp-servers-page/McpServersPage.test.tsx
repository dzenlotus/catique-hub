/**
 * Unit tests for `<McpServersPage>` (PROXY-S6 / ADR-0008).
 *
 * The IPC boundary is mocked at `@shared/api`; tests dispatch on the
 * command name and return canned results for the three queries the
 * page composes:
 *   1. `list_mcp_servers`            → `McpServer[]`.
 *   2. `get_mcp_server_status`       → `McpServerStatus`.
 *   3. `list_mcp_tools_by_server`    → `McpTool[]`.
 * Mutations (`refresh_mcp_server`, `delete_mcp_server`) are spied on
 * to assert the wire shape.
 *
 * Vendored providers: a fresh `QueryClient` plus the real
 * `ToastProvider` so the success toast actually mounts and is
 * queryable through `findByText`.
 */

import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { McpServer } from "@bindings/McpServer";
import type { McpServerStatus } from "@bindings/McpServerStatus";
import type { McpTool } from "@bindings/McpTool";
import type { RefreshReport } from "@bindings/RefreshReport";

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
import { Toaster } from "@widgets/toaster";
import { McpServersPage } from "./McpServersPage";

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
      <ToastProvider>
        {ui}
        <Toaster />
      </ToastProvider>
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
    toolCount: 2n,
    lastCallStartedAt: null,
    lastCallSuccess: null,
    ...overrides,
  };
}

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    id: "tool-1",
    name: "search",
    description: "Searches the upstream.",
    schemaJson: "{}",
    color: null,
    position: 0,
    serverId: "srv-1",
    upstreamName: "search",
    source: "upstream",
    lastSyncedAt: 1n,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

/**
 * Wires the IPC mock with a per-test dispatch table. Anything not in
 * the map rejects so failing tests scream loud instead of swallowing.
 */
function wireIpc(opts: {
  servers?: McpServer[];
  statusById?: Record<string, McpServerStatus>;
  toolsById?: Record<string, McpTool[]>;
  refresh?: RefreshReport;
}): void {
  invokeMock.mockImplementation((cmd, args) => {
    switch (cmd) {
      case "list_mcp_servers":
        return Promise.resolve(opts.servers ?? []);
      case "get_mcp_server_status": {
        const id = (args as { id: string }).id;
        return Promise.resolve(opts.statusById?.[id] ?? makeStatus({ serverId: id }));
      }
      case "list_mcp_tools_by_server": {
        const id = (args as { serverId: string }).serverId;
        return Promise.resolve(opts.toolsById?.[id] ?? []);
      }
      case "refresh_mcp_server":
        return Promise.resolve(
          opts.refresh ?? {
            added: 0n,
            schemaChanged: 0n,
            stillPresent: 0n,
            softDeleted: 0n,
          },
        );
      case "delete_mcp_server":
        return Promise.resolve();
      default:
        return Promise.reject(new Error(`unmocked ${cmd}`));
    }
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("McpServersPage", () => {
  it("renders empty state when no servers are registered", async () => {
    wireIpc({ servers: [] });
    renderWithProviders(<McpServersPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-empty"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/no mcp servers yet/i)).toBeInTheDocument();
  });

  it("renders a section per server with status dot reflecting health state", async () => {
    wireIpc({
      servers: [
        makeServer({ id: "a", name: "Healthy one" }),
        makeServer({ id: "b", name: "Degraded one" }),
        makeServer({ id: "c", name: "Unreachable one" }),
      ],
      statusById: {
        a: makeStatus({ serverId: "a", state: "healthy" }),
        b: makeStatus({ serverId: "b", state: "degraded" }),
        c: makeStatus({ serverId: "c", state: "unreachable" }),
      },
    });
    renderWithProviders(<McpServersPage />);

    // Wait for the status queries to resolve — the dot starts at the
    // pessimistic "unreachable" fallback until `get_mcp_server_status`
    // lands. Asserting `data-state="healthy"` directly forces the
    // wait through the per-server status query.
    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-status-dot-a").getAttribute("data-state"),
      ).toBe("healthy");
    });
    expect(
      screen.getByTestId("mcp-servers-page-status-dot-b").getAttribute("data-state"),
    ).toBe("degraded");
    expect(
      screen.getByTestId("mcp-servers-page-status-dot-c").getAttribute("data-state"),
    ).toBe("unreachable");
  });

  it("renders soft-deleted tools with the removed-in-upstream label", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1" })],
      statusById: { "srv-1": makeStatus() },
      toolsById: {
        "srv-1": [
          makeTool({ id: "live", name: "live_tool", lastSyncedAt: 1n }),
          makeTool({
            id: "ghost",
            name: "ghost_tool",
            lastSyncedAt: null,
          }),
        ],
      },
    });
    renderWithProviders(<McpServersPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-tool-name-ghost"),
      ).toBeInTheDocument();
    });
    const ghost = screen.getByTestId("mcp-servers-page-tool-name-ghost");
    expect(ghost.getAttribute("aria-label")).toMatch(/removed in upstream/i);
    expect(ghost.getAttribute("title")).toMatch(/removed in upstream/i);

    const live = screen.getByTestId("mcp-servers-page-tool-name-live");
    expect(live.getAttribute("aria-label")).toBeNull();
  });

  it("Refresh button calls refresh_mcp_server and surfaces the count toast", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1", name: "Atlassian" })],
      statusById: { "srv-1": makeStatus() },
      refresh: {
        added: 2n,
        schemaChanged: 1n,
        stillPresent: 4n,
        softDeleted: 3n,
      },
    });
    const { user } = renderWithProviders(<McpServersPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-refresh-srv-1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("mcp-servers-page-refresh-srv-1"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "refresh_mcp_server",
      );
      expect(call?.[1]).toEqual({ id: "srv-1" });
    });
    expect(
      await screen.findByText(/Atlassian: \+2, ~1, -3/),
    ).toBeInTheDocument();
  });

  it("Delete button opens confirm dialog and on confirm calls delete_mcp_server", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1", name: "Atlassian" })],
      statusById: { "srv-1": makeStatus() },
    });
    const { user } = renderWithProviders(<McpServersPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-delete-srv-1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("mcp-servers-page-delete-srv-1"));

    const confirm = await screen.findByTestId(
      "mcp-servers-page-delete-confirm-srv-1",
    );
    expect(confirm).toBeInTheDocument();

    await user.click(
      within(confirm).getByTestId(
        "mcp-servers-page-delete-confirm-srv-1-confirm",
      ),
    );

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "delete_mcp_server",
      );
      expect(call?.[1]).toEqual({ id: "srv-1" });
    });
  });
});
