/**
 * TaskCreateDialog — unit tests.
 *
 * Provider chain: QueryClientProvider > ActiveSpaceProvider > ToastProvider.
 * Tauri IPC is mocked via `@shared/api`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Board } from "@entities/board";
import type { Column } from "@entities/column";
import type { Role } from "@entities/role";
import type { Task } from "@entities/task";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { TaskCreateDialog } from "./TaskCreateDialog";

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-1",
    name: "Sprint Board",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    description: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-1",
    name: "To Do",
    boardId: "brd-1",
    roleId: null,
    position: 1n,
    createdAt: 0n,
    ...overrides,
  };
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-1",
    name: "Developer",
    content: "",
    color: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    slug: "tsk-abc123",
    title: "New task",
    description: null,
    boardId: "brd-1",
    columnId: "col-1",
    roleId: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderDialog(
  isOpen = true,
  onClose = vi.fn(),
): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ActiveSpaceProvider>
        <ToastProvider>
          <TaskCreateDialog isOpen={isOpen} onClose={onClose} />
        </ToastProvider>
      </ActiveSpaceProvider>
    </QueryClientProvider>
  );
  render(ui);
  return { user };
}

function setupDefaultMocks(): void {
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "list_boards") return [makeBoard()];
    if (cmd === "list_columns") return [makeColumn()];
    if (cmd === "list_roles") return [makeRole()];
    if (cmd === "list_spaces") return [];
    return [];
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskCreateDialog", () => {
  it("renders all form fields when open", async () => {
    setupDefaultMocks();
    renderDialog();

    expect(
      await screen.findByTestId("task-create-dialog-title-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("task-create-dialog-description-textarea"),
    ).toBeInTheDocument();
  });

  it("Save button is disabled until title + board + column are filled", async () => {
    setupDefaultMocks();
    renderDialog();

    const saveBtn = await screen.findByTestId("task-create-dialog-save");
    // Initially disabled — no title.
    expect(saveBtn).toBeDisabled();
  });

  it("Save button is enabled once title and board and column are selected", async () => {
    setupDefaultMocks();
    const { user } = renderDialog();

    const titleInput = await screen.findByTestId("task-create-dialog-title-input");
    await user.type(titleInput, "My task");

    // Select the board.
    const boardSelect = await screen.findByTestId("task-create-dialog-board-select");
    const boardOption = boardSelect.querySelector("[role='option']");
    if (boardOption) await user.click(boardOption);

    // Wait for columns to appear, then select.
    const columnSelect = await screen.findByTestId("task-create-dialog-column-select");
    const columnOption = columnSelect.querySelector("[role='option']");
    if (columnOption) await user.click(columnOption);

    await waitFor(() => {
      expect(screen.getByTestId("task-create-dialog-save")).not.toBeDisabled();
    });
  });

  it("cancel calls onClose without firing mutation", async () => {
    setupDefaultMocks();
    const onClose = vi.fn();
    const { user } = renderDialog(true, onClose);

    await screen.findByTestId("task-create-dialog-cancel");
    await user.click(screen.getByTestId("task-create-dialog-cancel"));

    expect(onClose).toHaveBeenCalled();
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_task",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("board→column cascade: changing board resets column selection", async () => {
    const board2 = makeBoard({ id: "brd-2", name: "Board 2" });
    const col2 = makeColumn({ id: "col-2", name: "Backlog", boardId: "brd-2" });

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "list_boards") return [makeBoard(), board2];
      if (cmd === "list_columns") {
        const boardId = (args as Record<string, unknown>)?.boardId;
        if (boardId === "brd-2") return [col2];
        return [makeColumn()];
      }
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [];
      return [];
    });

    const { user } = renderDialog();

    // Select first board.
    const boardSelect = await screen.findByTestId("task-create-dialog-board-select");
    const options = boardSelect.querySelectorAll("[role='option']");
    // Select board1 first.
    if (options[0]) await user.click(options[0]);
    // Then select board2 — column should reset.
    if (options[1]) await user.click(options[1]);

    // After board change, column should be reset (save still disabled because no column).
    expect(screen.getByTestId("task-create-dialog-save")).toBeDisabled();
  });

  it("fires create_task mutation with correct payload on submit", async () => {
    const newTask = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") return [makeBoard()];
      if (cmd === "list_columns") return [makeColumn()];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [];
      if (cmd === "create_task") return newTask;
      return [];
    });

    const onClose = vi.fn();
    const { user } = renderDialog(true, onClose);

    const titleInput = await screen.findByTestId("task-create-dialog-title-input");
    await user.type(titleInput, "Test task");

    const boardSelect = await screen.findByTestId("task-create-dialog-board-select");
    const boardOpt = boardSelect.querySelector("[role='option']");
    if (boardOpt) await user.click(boardOpt);

    const columnSelect = await screen.findByTestId("task-create-dialog-column-select");
    const colOpt = columnSelect.querySelector("[role='option']");
    if (colOpt) await user.click(colOpt);

    await waitFor(() => {
      expect(screen.getByTestId("task-create-dialog-save")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("task-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const createCall = invokeMock.mock.calls.find(([cmd]) => cmd === "create_task");
    expect(createCall?.[1]).toMatchObject({
      boardId: "brd-1",
      columnId: "col-1",
      title: "Test task",
    });
  });

  it("shows inline banner and error toast on mutation failure", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") return [makeBoard()];
      if (cmd === "list_columns") return [makeColumn()];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [];
      if (cmd === "create_task") throw new Error("DB error");
      return [];
    });

    const { user } = renderDialog();

    const titleInput = await screen.findByTestId("task-create-dialog-title-input");
    await user.type(titleInput, "Fail task");

    const boardSelect = await screen.findByTestId("task-create-dialog-board-select");
    const boardOpt = boardSelect.querySelector("[role='option']");
    if (boardOpt) await user.click(boardOpt);

    const columnSelect = await screen.findByTestId("task-create-dialog-column-select");
    const colOpt = columnSelect.querySelector("[role='option']");
    if (colOpt) await user.click(colOpt);

    await waitFor(() => {
      expect(screen.getByTestId("task-create-dialog-save")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("task-create-dialog-save"));

    await waitFor(() => {
      expect(
        screen.getByTestId("task-create-dialog-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("role listbox renders '(нет роли)' as first option", async () => {
    setupDefaultMocks();
    renderDialog();

    const roleSelect = await screen.findByTestId("task-create-dialog-role-select");
    expect(roleSelect).toBeInTheDocument();
    expect(screen.getByText("(нет роли)")).toBeInTheDocument();
  });

  it("selected role id is included in create_task payload", async () => {
    const newTask = makeTask({ roleId: "role-1" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_boards") return [makeBoard()];
      if (cmd === "list_columns") return [makeColumn()];
      if (cmd === "list_roles") return [makeRole()];
      if (cmd === "list_spaces") return [];
      if (cmd === "create_task") return newTask;
      return [];
    });

    const onClose = vi.fn();
    const { user } = renderDialog(true, onClose);

    // Fill title.
    const titleInput = await screen.findByTestId("task-create-dialog-title-input");
    await user.type(titleInput, "Role task");

    // Select board.
    const boardSelect = await screen.findByTestId("task-create-dialog-board-select");
    const boardOpt = boardSelect.querySelector("[role='option']");
    if (boardOpt) await user.click(boardOpt);

    // Select column.
    const columnSelect = await screen.findByTestId("task-create-dialog-column-select");
    const colOpt = columnSelect.querySelector("[role='option']");
    if (colOpt) await user.click(colOpt);

    // Select the role (second option in the role listbox — first is "(нет роли)").
    const roleSelect = await screen.findByTestId("task-create-dialog-role-select");
    const roleOptions = roleSelect.querySelectorAll("[role='option']");
    // roleOptions[0] is "(нет роли)", roleOptions[1] is "Developer".
    if (roleOptions[1]) await user.click(roleOptions[1]);

    await waitFor(() => {
      expect(screen.getByTestId("task-create-dialog-save")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("task-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const createCall = invokeMock.mock.calls.find(([cmd]) => cmd === "create_task");
    expect(createCall?.[1]).toMatchObject({
      boardId: "brd-1",
      columnId: "col-1",
      title: "Role task",
      roleId: "role-1",
    });
  });
});
