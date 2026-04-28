import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Column } from "@entities/column";
import type { Task } from "@entities/task";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { KanbanBoard } from "./KanbanBoard";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement) {
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

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-todo",
    boardId: "brd-1",
    name: "Todo",
    position: 1n,
    roleId: null,
    createdAt: 0n,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk-1",
    boardId: "brd-1",
    columnId: "col-todo",
    slug: "tsk-abc",
    title: "Task 1",
    description: null,
    position: 1,
    roleId: null,
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

describe("KanbanBoard", () => {
  it("renders 3 skeleton columns × 4 cards while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<KanbanBoard boardId="brd-1" />);
    expect(screen.getByTestId("kanban-board-loading")).toBeInTheDocument();
  });

  it("shows the empty CTA when there are no columns on the board", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_columns") return [] satisfies Column[];
      if (cmd === "list_tasks") return [] satisfies Task[];
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<KanbanBoard boardId="brd-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-empty")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("kanban-board-create-first-column"),
    ).toBeInTheDocument();
  });

  it("renders an inline error with retry when the columns query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_columns") throw new Error("transport down");
      if (cmd === "list_tasks") return [] satisfies Task[];
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<KanbanBoard boardId="brd-1" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders one KanbanColumn per column with the right tasks grouped", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_columns") {
        return [
          makeColumn({ id: "col-1", name: "Todo", position: 1n }),
          makeColumn({ id: "col-2", name: "Doing", position: 2n }),
        ] satisfies Column[];
      }
      if (cmd === "list_tasks") {
        return [
          makeTask({ id: "t1", columnId: "col-1", title: "First" }),
          makeTask({ id: "t2", columnId: "col-1", title: "Second" }),
          makeTask({ id: "t3", columnId: "col-2", title: "Third" }),
        ] satisfies Task[];
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<KanbanBoard boardId="brd-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
    });
    expect(screen.getByTestId("kanban-column-col-1")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-col-2")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
  });

  it("filters out tasks that don't belong to the current board", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_columns") {
        return [
          makeColumn({ id: "col-1", boardId: "brd-1" }),
        ] satisfies Column[];
      }
      if (cmd === "list_tasks") {
        return [
          makeTask({
            id: "t-mine",
            boardId: "brd-1",
            columnId: "col-1",
            title: "Belongs",
          }),
          makeTask({
            id: "t-other",
            boardId: "brd-OTHER",
            columnId: "col-OTHER",
            title: "Does not belong",
          }),
        ] satisfies Task[];
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<KanbanBoard boardId="brd-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
    });
    expect(screen.getByText("Belongs")).toBeInTheDocument();
    expect(screen.queryByText("Does not belong")).toBeNull();
  });

  it("creates a column from the empty CTA and refetches the list", async () => {
    let listCount = 0;
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_columns") {
        listCount += 1;
        if (listCount === 1) return [] satisfies Column[];
        return [
          makeColumn({ id: "col-new", name: "Inbox" }),
        ] satisfies Column[];
      }
      if (cmd === "list_tasks") return [] satisfies Task[];
      if (cmd === "create_column") {
        return makeColumn({ id: "col-new", name: "Inbox" });
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(<KanbanBoard boardId="brd-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("kanban-board-empty")).toBeInTheDocument();
    });
    await user.click(
      screen.getByTestId("kanban-board-create-first-column"),
    );
    const input = await screen.findByLabelText(/column name/i);
    await user.type(input, "Inbox");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
    });
    expect(screen.getByText("Inbox")).toBeInTheDocument();

    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_column",
    );
    expect(createCall?.[1]).toEqual({
      boardId: "brd-1",
      name: "Inbox",
      position: 1,
    });
  });
});
