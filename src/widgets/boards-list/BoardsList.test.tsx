import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Board } from "@entities/board";
import type { Space } from "@entities/space";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";

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
  render(
    <QueryClientProvider client={client}>
      <ActiveSpaceProvider>{ui}</ActiveSpaceProvider>
    </QueryClientProvider>,
  );
  return { client, user };
}

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-1",
    name: "Roadmap",
    spaceId: "default",
    roleId: null,
    position: 1,
    description: null,
    color: null,
    icon: null,
    isDefault: false,
    ownerRoleId: "maintainer-system",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "spc-default",
    name: "default",
    prefix: "def",
    description: null,
    color: null,
    icon: null,
    isDefault: true,
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

  it("shows the create header button always (loading state)", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<BoardsList />);
    expect(screen.getByTestId("boards-list-create-button")).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") return [] satisfies Board[];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected command: ${cmd}`);
    });
    renderWithClient(<BoardsList />);
    await waitFor(() => {
      expect(screen.getByTestId("boards-list-empty")).toBeInTheDocument();
    });
    // Zero boards in DB — generic copy shown.
    expect(screen.getByText("No boards yet")).toBeInTheDocument();
  });

  it("renders one BoardCard per board when populated", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards")
        return [
          makeBoard({ id: "brd-1", name: "Roadmap", spaceId: "spc-default" }),
          makeBoard({ id: "brd-2", name: "Bugs", spaceId: "spc-default" }),
          makeBoard({ id: "brd-3", name: "Backlog", spaceId: "spc-default" }),
        ] satisfies Board[];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected command: ${cmd}`);
    });
    renderWithClient(<BoardsList />);
    await waitFor(() => {
      expect(screen.getByTestId("boards-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Bugs")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") throw new Error("transport down");
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected command: ${cmd}`);
    });
    renderWithClient(<BoardsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("creates a board and invalidates the list cache (refetches)", async () => {
    const newBoard = makeBoard({
      id: "brd-new",
      name: "Sprint 14",
      spaceId: "spc-default",
    });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") {
        return invokeMock.mock.calls.filter(
          ([c]) => c === "list_boards",
        ).length === 1
          ? []
          : [newBoard];
      }
      if (cmd === "list_spaces") {
        return [makeSpace()];
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

    // Open the dialog from the empty CTA (header button).
    await user.click(screen.getByTestId("boards-list-create-button"));

    // Dialog open — fill name and submit via the BoardCreateDialog.
    const nameInput = await screen.findByTestId("board-create-dialog-name-input");
    await user.type(nameInput, "Sprint 14");

    // Wait for space picker to be available (spaces query).
    await screen.findByTestId("board-create-dialog-space-select");
    await user.click(screen.getByTestId("board-create-dialog-save"));

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
    // ctq-105: BoardCreateDialog now sends `ownerRoleId` (Maintainer
    // by default) so the schema-required `boards.owner_role_id` is
    // never elided from the IPC payload.
    expect(createCall?.[1]).toEqual({
      name: "Sprint 14",
      spaceId: "spc-default",
      ownerRoleId: "maintainer-system",
      icon: "PixelInterfaceEssentialList",
    });

    // The list should have been called at least twice (initial + after
    // invalidation triggered by the mutation's onSuccess).
    const listCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "list_boards",
    );
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("validates that a board name is required before submitting", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") return [] satisfies Board[];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected command: ${cmd}`);
    });
    const { user } = renderWithClient(<BoardsList />);

    await waitFor(() => {
      expect(screen.getByTestId("boards-list-empty")).toBeInTheDocument();
    });

    // Open dialog via header button.
    await user.click(screen.getByTestId("boards-list-create-button"));

    // Space select should appear; save should be disabled (name empty).
    await screen.findByTestId("board-create-dialog-space-select");
    const saveBtn = screen.getByTestId("board-create-dialog-save");
    expect(saveBtn).toBeDisabled();

    // Clicking while disabled should not fire the mutation.
    await act(async () => {
      await user.click(saveBtn);
    });

    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_board",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("calls onSelectBoard with the board id when a card is activated", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") {
        return [makeBoard({ id: "brd-pick", name: "Pick me", spaceId: "spc-default" })];
      }
      if (cmd === "list_spaces") {
        return [makeSpace()];
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    const onSelectBoard = vi.fn();
    const { user } = renderWithClient(
      <BoardsList onSelectBoard={onSelectBoard} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("boards-list-grid")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Pick me"));
    expect(onSelectBoard).toHaveBeenCalledWith("brd-pick");
  });

  it("shows create-space CTA and welcome heading when no spaces exist", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") return [] satisfies Board[];
      if (cmd === "list_spaces") return [];
      throw new Error(`unexpected command: ${cmd}`);
    });
    renderWithClient(<BoardsList />);

    await waitFor(() => {
      expect(screen.getByTestId("boards-list-empty")).toBeInTheDocument();
    });
    expect(
      screen.getByText("No spaces yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("boards-list-create-space-button"),
    ).toBeInTheDocument();
  });

  it("filters boards by active space — only the 2 matching boards render", async () => {
    // Active space will be spc-A (isDefault: true). 2 boards in spc-A, 1 in spc-B.
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards")
        return [
          makeBoard({ id: "brd-a1", name: "Доска А1", spaceId: "spc-A" }),
          makeBoard({ id: "brd-a2", name: "Доска А2", spaceId: "spc-A" }),
          makeBoard({ id: "brd-b1", name: "Доска Б1", spaceId: "spc-B" }),
        ] satisfies Board[];
      if (cmd === "list_spaces")
        return [makeSpace({ id: "spc-A", isDefault: true })];
      throw new Error(`unexpected command: ${cmd}`);
    });

    renderWithClient(<BoardsList />);

    await waitFor(() => {
      expect(screen.getByTestId("boards-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("Доска А1")).toBeInTheDocument();
    expect(screen.getByText("Доска А2")).toBeInTheDocument();
    expect(screen.queryByText("Доска Б1")).not.toBeInTheDocument();
  });

  it("shows space-specific empty state when active space has no boards but others do", async () => {
    // Active space is spc-A (default). No boards in spc-A; one board in spc-B.
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards")
        return [
          makeBoard({ id: "brd-b1", name: "Доска Б1", spaceId: "spc-B" }),
        ] satisfies Board[];
      if (cmd === "list_spaces")
        return [makeSpace({ id: "spc-A", isDefault: true })];
      throw new Error(`unexpected command: ${cmd}`);
    });

    renderWithClient(<BoardsList />);

    await waitFor(() => {
      expect(screen.getByTestId("boards-list-empty")).toBeInTheDocument();
    });
    expect(
      screen.getByText("No boards yet"),
    ).toBeInTheDocument();
  });
});
