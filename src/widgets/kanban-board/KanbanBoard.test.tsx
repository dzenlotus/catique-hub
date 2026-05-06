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
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactElement } from "react";

import type { Board } from "@entities/board";
import type { Column } from "@entities/column";
import type { Task } from "@entities/task";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    // audit-#17 dedup: entity APIs call `invokeWithAppError`; mocking
    // both to the same fn means the test driver only configures one
    // implementation but every IPC path resolves.
    invokeWithAppError: fn,
    // EventsProvider isn't mounted in the test tree, but `on` is exported
    // from @shared/api and any incidental import resolves cleanly.
    on: vi.fn(() => Promise.resolve(() => {})),
  };
});

import { invoke } from "@shared/api";
import { KanbanBoard } from "./KanbanBoard";

const invokeMock = vi.mocked(invoke);

/**
 * KanbanBoard end-to-end test surface (F-02 of ctq-75).
 *
 * The widget orchestrates 3 queries (board, columns, tasks) + 5
 * mutations and renders four major branches: pending / error / empty
 * (no columns) / loaded. We exercise each branch and assert the
 * post-round-19c behaviours that the audit called out:
 *
 *  - F-10 — Retry button refetches BOTH columnsQuery and tasksQuery,
 *    not just the failed one.
 *  - The board header surfaces the SettingCog "Board options" button
 *    (round-19c icon swap, replacing the heavy NavigationMenu1 frame).
 */

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-1",
    name: "Sprint Board",
    spaceId: "spc-1",
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

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-1",
    name: "Backlog",
    boardId: "brd-1",
    roleId: null,
    position: 1n,
    createdAt: 0n,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk-1",
    boardId: "brd-1",
    columnId: "col-1",
    slug: "tsk-1",
    title: "First task",
    description: null,
    position: 1,
    roleId: null,
    stepLog: "",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderBoard(boardId = "brd-1"): {
  user: ReturnType<typeof userEvent.setup>;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  const { hook } = memoryLocation({ path: `/boards/${boardId}` });
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <ActiveSpaceProvider>
        <ToastProvider>
          <Router hook={hook}>
            <KanbanBoard boardId={boardId} />
          </Router>
        </ToastProvider>
      </ActiveSpaceProvider>
    </QueryClientProvider>
  );
  render(tree);
  return { user, client };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KanbanBoard", () => {
  // The pending-skeleton state cannot be safely tested today because
  // KanbanBoard uses `columnsQuery.data ?? []` which produces a fresh
  // empty-array reference on every render while data is undefined; that
  // invalidates the `useMemo(serverItems)` and the dependent `useEffect`
  // never settles. Out of scope for this round — fix is to memoize the
  // empty fallback (or set `placeholderData: []`) at the entity-hook
  // layer; tracked alongside the audit's F-09 god-component split.
  it.todo("renders the loading skeleton while columns + tasks are pending");

  it("renders the error banner when columns query fails and Retry refetches BOTH queries (F-10)", async () => {
    // First two calls (one per query) fail; subsequent retry calls succeed.
    let listColumnsCalls = 0;
    let listTasksByBoardCalls = 0;
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return makeBoard();
      if (cmd === "list_columns") {
        listColumnsCalls += 1;
        if (listColumnsCalls === 1) throw new Error("network down");
        return [makeColumn()];
      }
      if (cmd === "list_tasks") {
        listTasksByBoardCalls += 1;
        if (listTasksByBoardCalls === 1) throw new Error("network down");
        return [makeTask()];
      }
      return null;
    });
    const { user } = renderBoard();
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/Failed to load board/i);
    expect(banner).toHaveTextContent(/network down/i);

    await user.click(screen.getByRole("button", { name: /retry/i }));

    // After the click, both queries must have been re-invoked. The first
    // call of each was the initial mount; we expect `2` to confirm a
    // refetch happened on each, not just the failed one.
    await waitFor(() => {
      expect(listColumnsCalls).toBeGreaterThanOrEqual(2);
      expect(listTasksByBoardCalls).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders the no-columns empty state with a 'Create column' button", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return makeBoard();
      if (cmd === "list_columns") return [];
      if (cmd === "list_tasks") return [];
      return null;
    });
    renderBoard();
    expect(await screen.findByText(/No columns yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create column/i }),
    ).toBeInTheDocument();
  });

  it("renders the loaded board with header, board name and SettingCog options button", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board")
        return makeBoard({ name: "Round-19 board", description: "Plan" });
      if (cmd === "list_columns")
        return [
          makeColumn({ id: "c1", name: "Backlog" }),
          makeColumn({ id: "c2", name: "Doing", position: 2n }),
        ];
      if (cmd === "list_tasks") return [makeTask({ columnId: "c1" })];
      return null;
    });
    renderBoard();
    expect(
      await screen.findByRole("heading", { name: /Round-19 board/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /board options/i }),
    ).toBeInTheDocument();
    // Both columns rendered.
    expect(screen.getByTestId("kanban-column-c1")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-c2")).toBeInTheDocument();
    // Task lives in c1.
    expect(screen.getByTestId("task-card-tsk-1")).toBeInTheDocument();
  });
});
