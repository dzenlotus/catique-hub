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

  it("does NOT render a 'Create board' header button (audit-#6)", () => {
    // audit-#6 invariant: BoardsList no longer hosts a standalone create
    // affordance. Boards materialise as a side-effect of adding a role
    // to a space (sidebar "+" affordance owns the trigger).
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<BoardsList />);
    expect(screen.queryByTestId("boards-list-create-button")).toBeNull();
    expect(screen.queryByText("Create board")).toBeNull();
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

  it("does NOT expose a board-creation entry point from BoardsList (audit-#6)", async () => {
    // audit-#6 invariant: the empty-state for "no boards in this space"
    // points the user at the SpacesSidebar "+" affordance instead of
    // hosting a standalone create button. The BoardCreateDialog widget
    // is therefore unreachable from here — assert it stays unmounted.
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") return [] satisfies Board[];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected command: ${cmd}`);
    });

    renderWithClient(<BoardsList />);

    await waitFor(() => {
      expect(screen.getByTestId("boards-list-empty")).toBeInTheDocument();
    });

    // Empty-state copy points at the sidebar workflow.
    expect(screen.getByText(/Add a role to a space/i)).toBeInTheDocument();

    // No create-board CTA, no BoardCreateDialog mounted.
    expect(screen.queryByTestId("boards-list-create-button")).toBeNull();
    expect(screen.queryByText("Create board")).toBeNull();
    expect(
      screen.queryByTestId("board-create-dialog-name-input"),
    ).toBeNull();

    // The mutation cannot fire from here either.
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_board",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("does NOT mount the BoardCreateDialog when boards exist either", async () => {
    // Same audit-#6 invariant from the populated branch: the grid renders
    // BoardCard rows but no inline create affordance, so attempting to
    // surface BoardCreateDialog from here is impossible. We assert no
    // dialog mounts and no create-board IPC ever fires during render.
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") {
        return [
          makeBoard({ id: "brd-1", name: "Roadmap", spaceId: "spc-default" }),
        ] satisfies Board[];
      }
      if (cmd === "list_spaces") {
        return [makeSpace()];
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    // act() wrapper on the render keeps async state-updates from the
    // post-mutation invalidation cycle (which doesn't run here) silent.
    await act(async () => {
      renderWithClient(<BoardsList />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("boards-list-grid")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("boards-list-create-button")).toBeNull();
    expect(
      screen.queryByTestId("board-create-dialog-name-input"),
    ).toBeNull();
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
