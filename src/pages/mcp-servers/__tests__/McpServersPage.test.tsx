/**
 * Unit tests for `<McpServersPage>` (PROXY-S6 / ADR-0008, round-22).
 *
 * The IPC boundary is mocked at `@shared/api`; tests dispatch on the
 * command name and return canned results for the queries the page
 * composes:
 *   1. `list_mcp_servers`            → `McpServer[]`.
 *   2. `get_mcp_server`              → `McpServer` (detail pane).
 *   3. `get_mcp_server_status`       → `McpServerStatus`.
 *   4. `list_mcp_tools_by_server`    → `McpTool[]`.
 * Mutations (`refresh_mcp_server`, `delete_mcp_server`) are spied on
 * to assert the wire shape.
 *
 * Wouter's `memoryLocation` mounts the page under the routed paths so
 * the URL-driven selection state behaves the same as in production.
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
import { createRef } from "react";
import {
  TestRouter,
  type TestRouterControls,
} from "@shared/lib";
import type { ReactElement } from "react";

import type { McpServer } from "@bindings/McpServer";
import type { McpServerStatus } from "@bindings/McpServerStatus";
import type { McpTool } from "@bindings/McpTool";
import type { RefreshReport } from "@bindings/RefreshReport";
import { routes } from "@app/routes";

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
import { ToastProvider } from "@shared/lib";
import { Toaster } from "@widgets/toaster";
import { McpServersPage } from "../McpServersPage";

const invokeMock = vi.mocked(invoke);

function renderWithProviders(
  ui: ReactElement,
  initialPath: string = routes.mcpServers,
): {
  user: ReturnType<typeof userEvent.setup>;
  navigate: (path: string) => void;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  const controlRef = createRef<TestRouterControls>();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TestRouter path={initialPath} controlRef={controlRef}>
          {ui}
        </TestRouter>
        <Toaster />
      </ToastProvider>
    </QueryClientProvider>,
  );
  const navigate = (to: string): void => {
    controlRef.current?.navigate(to);
  };
  return { user, navigate };
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
      case "get_mcp_server": {
        const id = (args as { id: string }).id;
        const found = (opts.servers ?? []).find((s) => s.id === id);
        if (!found) return Promise.reject(new Error(`no server ${id}`));
        return Promise.resolve(found);
      }
      case "get_mcp_server_status": {
        const id = (args as { id: string }).id;
        return Promise.resolve(
          opts.statusById?.[id] ?? makeStatus({ serverId: id }),
        );
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

describe("McpServersPage — overview", () => {
  it("renders an empty overview when no servers are registered", async () => {
    wireIpc({ servers: [] });
    renderWithProviders(<McpServersPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-overview"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("mcp-servers-page-overview-count"),
    ).toHaveTextContent(/no servers registered/i);
  });

  it("renders the rail with every server when servers exist", async () => {
    wireIpc({
      servers: [
        makeServer({ id: "a", name: "Atlassian" }),
        makeServer({ id: "b", name: "Notion" }),
      ],
    });
    renderWithProviders(<McpServersPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-sidebar-row-srv:a"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("mcp-servers-sidebar-row-srv:b"),
    ).toBeInTheDocument();
  });
});

describe("McpServersPage — expansion + tool children", () => {
  it("clicking the chevron expands the server and shows its tool children", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1" })],
      toolsById: {
        "srv-1": [
          makeTool({ id: "t-1", name: "search" }),
          makeTool({ id: "t-2", name: "create_issue" }),
        ],
      },
    });
    const { user } = renderWithProviders(<McpServersPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-sidebar-toggle-srv:srv-1"),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByTestId("mcp-servers-sidebar-toggle-srv:srv-1"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-sidebar-row-tool:t-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("mcp-servers-sidebar-row-tool:t-2"),
    ).toBeInTheDocument();
  });

  it("auto-expands the parent server when landing on a tool URL", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1", name: "Atlassian" })],
      toolsById: {
        "srv-1": [makeTool({ id: "t-1", name: "search" })],
      },
    });
    renderWithProviders(
      <McpServersPage />,
      `/mcp-servers/srv-1/tools/t-1`,
    );

    // The selected tool row should mount under its server.
    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-sidebar-row-tool:t-1"),
      ).toBeInTheDocument();
    });
  });
});

describe("McpServersPage — selection routes content pane", () => {
  it("selecting a server row navigates to /mcp-servers/:serverId and shows the detail pane", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1", name: "Atlassian" })],
      statusById: {
        "srv-1": makeStatus({ serverId: "srv-1", state: "healthy" }),
      },
    });
    const { user } = renderWithProviders(<McpServersPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-sidebar-row-srv:srv-1"),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByTestId("mcp-servers-sidebar-row-srv:srv-1"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-detail-srv-1"),
      ).toBeInTheDocument();
    });
    // Status dot resolves to "healthy" after the status query lands.
    await waitFor(() => {
      expect(
        screen
          .getByTestId("mcp-servers-page-status-dot-srv-1")
          .getAttribute("data-state"),
      ).toBe("healthy");
    });
  });

  it("selecting a tool row navigates to /mcp-servers/:serverId/tools/:toolId and shows tool detail", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1", name: "Atlassian" })],
      toolsById: {
        "srv-1": [
          makeTool({
            id: "t-1",
            name: "search",
            description: "Searches the upstream.",
          }),
        ],
      },
    });
    const { user } = renderWithProviders(<McpServersPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-sidebar-toggle-srv:srv-1"),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByTestId("mcp-servers-sidebar-toggle-srv:srv-1"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-sidebar-row-tool:t-1"),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByTestId("mcp-servers-sidebar-row-tool:t-1"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-tool-detail-t-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("mcp-servers-page-tool-description-t-1"),
    ).toHaveTextContent(/searches the upstream/i);
  });

  it("renders soft-deleted tools with the removed-in-upstream banner on the tool detail pane", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1" })],
      toolsById: {
        "srv-1": [
          makeTool({ id: "ghost", name: "ghost_tool", lastSyncedAt: null }),
        ],
      },
    });
    renderWithProviders(
      <McpServersPage />,
      `/mcp-servers/srv-1/tools/ghost`,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-page-tool-removed-ghost"),
      ).toBeInTheDocument();
    });
    const name = screen.getByTestId("mcp-servers-page-tool-name-ghost");
    expect(name.getAttribute("aria-label")).toMatch(/removed in upstream/i);
    expect(name.getAttribute("title")).toMatch(/removed in upstream/i);
  });
});

describe("McpServersPage — server detail actions", () => {
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
    const { user } = renderWithProviders(
      <McpServersPage />,
      `/mcp-servers/srv-1`,
    );

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
    const { user } = renderWithProviders(
      <McpServersPage />,
      `/mcp-servers/srv-1`,
    );

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

  it("Refresh / Delete buttons live in the detail pane, not in the sidebar rows", async () => {
    wireIpc({
      servers: [makeServer({ id: "srv-1", name: "Atlassian" })],
    });
    renderWithProviders(<McpServersPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-servers-sidebar-row-srv:srv-1"),
      ).toBeInTheDocument();
    });

    // No refresh / delete buttons on the rail.
    expect(
      screen.queryByTestId("mcp-servers-page-refresh-srv-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mcp-servers-page-delete-srv-1"),
    ).not.toBeInTheDocument();
  });
});
