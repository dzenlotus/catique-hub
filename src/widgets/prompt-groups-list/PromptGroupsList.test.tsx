import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { PromptGroup } from "@entities/prompt-group";

// Mock Tauri invoke at the shared/api boundary so all four states
// (loading, error, empty, populated) can be driven from here.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { PromptGroupsList } from "./PromptGroupsList";

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

function makeGroup(overrides: Partial<PromptGroup> = {}): PromptGroup {
  return {
    id: "group-1",
    name: "Core Prompts",
    color: null,
    position: 0n,
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

describe("PromptGroupsList", () => {
  it("renders 3 skeleton cards while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<PromptGroupsList />);
    const skeletons = screen.getAllByTestId("prompt-group-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("shows the create header button always (loading state)", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<PromptGroupsList />);
    expect(
      screen.getByTestId("prompt-groups-list-create-button"),
    ).toBeInTheDocument();
  });

  it("shows the loading grid container while pending", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<PromptGroupsList />);
    expect(
      screen.getByTestId("prompt-groups-list-loading"),
    ).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", async () => {
    invokeMock.mockResolvedValue([]);
    renderWithClient(<PromptGroupsList />);
    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-groups-list-empty"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/нет групп промптов/i)).toBeInTheDocument();
  });

  it("renders one PromptGroupCard per group when populated", async () => {
    // list_prompt_groups returns groups; list_prompt_group_members returns []
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_prompt_groups") {
        return Promise.resolve([
          makeGroup({ id: "g-1", name: "Alpha" }),
          makeGroup({ id: "g-2", name: "Beta" }),
        ]);
      }
      return Promise.resolve([]);
    });
    renderWithClient(<PromptGroupsList />);
    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-groups-list-grid"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    invokeMock.mockRejectedValue(new Error("transport down"));
    renderWithClient(<PromptGroupsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /повторить/i }),
    ).toBeInTheDocument();
  });

  it("calls onSelectGroup with the group id when a card is activated", async () => {
    const pickedGroup = makeGroup({ id: "g-pick", name: "Pick me" });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_prompt_groups") {
        return Promise.resolve([pickedGroup]);
      }
      if (cmd === "get_prompt_group") return Promise.resolve(pickedGroup);
      if (cmd === "list_prompt_group_members") return Promise.resolve([]);
      if (cmd === "list_prompts") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const onSelectGroup = vi.fn();
    const { user } = renderWithClient(
      <PromptGroupsList onSelectGroup={onSelectGroup} />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-groups-list-grid"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByText("Pick me"));
    expect(onSelectGroup).toHaveBeenCalledWith("g-pick");
  });
});
