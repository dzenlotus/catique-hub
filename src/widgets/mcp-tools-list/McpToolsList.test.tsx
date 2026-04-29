import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { McpTool } from "@entities/mcp-tool";

// Mock the Tauri invoke wrapper at the shared/api boundary — this is
// the single place IPC traffic crosses, so all four states (loading,
// error, empty, populated) can be driven from here.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { McpToolsList } from "./McpToolsList";

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

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    id: "tool-1",
    name: "Search Tool",
    description: "Searches the web.",
    schemaJson: "{}",
    color: null,
    position: 0,
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

describe("McpToolsList", () => {
  it("renders 3 skeleton cards while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<McpToolsList />);
    const skeletons = screen.getAllByTestId("mcp-tool-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("shows the create header button always (loading state)", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<McpToolsList />);
    expect(screen.getByTestId("mcp-tools-list-create-button")).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", async () => {
    invokeMock.mockResolvedValue([] satisfies McpTool[]);
    renderWithClient(<McpToolsList />);
    await waitFor(() => {
      expect(screen.getByTestId("mcp-tools-list-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/no mcp servers yet/i)).toBeInTheDocument();
  });

  it("renders one McpToolCard per tool when populated", async () => {
    invokeMock.mockResolvedValue([
      makeTool({ id: "tool-1", name: "Search Tool" }),
      makeTool({ id: "tool-2", name: "Fetch Tool" }),
      makeTool({ id: "tool-3", name: "Parse Tool" }),
    ] satisfies McpTool[]);
    renderWithClient(<McpToolsList />);
    await waitFor(() => {
      expect(screen.getByTestId("mcp-tools-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("Search Tool")).toBeInTheDocument();
    expect(screen.getByText("Fetch Tool")).toBeInTheDocument();
    expect(screen.getByText("Parse Tool")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    invokeMock.mockRejectedValue(new Error("transport down"));
    renderWithClient(<McpToolsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /повторить/i })).toBeInTheDocument();
  });

  it("calls onSelectTool with the tool id when a card is activated", async () => {
    invokeMock.mockResolvedValue([
      makeTool({ id: "tool-pick", name: "Pick me" }),
    ] satisfies McpTool[]);
    const onSelectTool = vi.fn();
    const { user } = renderWithClient(
      <McpToolsList onSelectTool={onSelectTool} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("mcp-tools-list-grid")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Pick me"));
    expect(onSelectTool).toHaveBeenCalledWith("tool-pick");
  });

  it("renders the loading grid container while pending", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<McpToolsList />);
    expect(screen.getByTestId("mcp-tools-list-loading")).toBeInTheDocument();
  });
});
