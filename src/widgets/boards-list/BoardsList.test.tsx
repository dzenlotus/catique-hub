import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Board } from "@entities/board";

// Mock the Tauri invoke wrapper at the shared/api boundary — this is
// the single place IPC traffic crosses, so all four states (loading,
// error, empty, populated) plus the create-mutation flow can be
// driven from here. We avoid mocking @entities/board itself to keep
// the test exercising the real react-query store.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { BoardsList } from "./BoardsList";

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

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-1",
    name: "Roadmap",
    spaceId: "default",
    roleId: null,
    position: 1,
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

describe("BoardsList", () => {
  it("renders 3 skeleton cards while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<BoardsList />);
    const skeletons = screen.getAllByTestId("board-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("shows the empty CTA when the list is empty", async () => {
    invokeMock.mockResolvedValue([] satisfies Board[]);
    renderWithClient(<BoardsList />);
    await waitFor(() => {
      expect(screen.getByTestId("boards-list-empty")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /create your first board/i }),
    ).toBeInTheDocument();
  });

  it("renders one BoardCard per board when populated", async () => {
    invokeMock.mockResolvedValue([
      makeBoard({ id: "brd-1", name: "Roadmap" }),
      makeBoard({ id: "brd-2", name: "Bugs" }),
      makeBoard({ id: "brd-3", name: "Backlog" }),
    ] satisfies Board[]);
    renderWithClient(<BoardsList />);
    await waitFor(() => {
      expect(screen.getByTestId("boards-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Bugs")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    invokeMock.mockRejectedValue(new Error("transport down"));
    renderWithClient(<BoardsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("creates a board and invalidates the list cache (refetches)", async () => {
    // 1st call: list_boards → empty.
    // 2nd call: create_board → returns the new board.
    // 3rd call (after invalidation): list_boards → returns [newBoard].
    const newBoard = makeBoard({ id: "brd-new", name: "Sprint 14" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") {
        return invokeMock.mock.calls.filter(
          ([c]) => c === "list_boards",
        ).length === 1
          ? []
          : [newBoard];
      }
      if (cmd === "create_board") {
        return newBoard;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const { user } = renderWithClient(<BoardsList />);

    // Wait for the empty state.
    await waitFor(() => {
      expect(screen.getByTestId("boards-list-empty")).toBeInTheDocument();
    });

    // Open the dialog from the empty CTA.
    await user.click(
      screen.getByRole("button", { name: /create your first board/i }),
    );

    // Dialog open — fill name and submit.
    const nameInput = await screen.findByLabelText("Board name");
    await user.type(nameInput, "Sprint 14");
    await user.click(screen.getByRole("button", { name: /^create board$/i }));

    // After mutation success: dialog closes, list re-fetches and now
    // contains the new board.
    await waitFor(() => {
      expect(screen.getByTestId("boards-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("Sprint 14")).toBeInTheDocument();

    // Verify invoke was called with the right args (camelCase).
    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_board",
    );
    expect(createCall).toBeDefined();
    expect(createCall?.[1]).toEqual({ name: "Sprint 14", spaceId: "default" });

    // The list should have been called at least twice (initial + after
    // invalidation triggered by the mutation's onSuccess).
    const listCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_boards",
    );
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("validates that a board name is required before submitting", async () => {
    invokeMock.mockResolvedValue([] satisfies Board[]);
    const { user } = renderWithClient(<BoardsList />);

    await waitFor(() => {
      expect(screen.getByTestId("boards-list-empty")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: /create your first board/i }),
    );
    // Submit empty form.
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /^create board$/i }));
    });

    // No create_board IPC call should have fired.
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_board",
    );
    expect(createCalls).toHaveLength(0);
    // An error message is rendered inside the dialog.
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
});
