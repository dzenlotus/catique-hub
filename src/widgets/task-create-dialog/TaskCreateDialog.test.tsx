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
    isSystem: false,
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
    stepLog: "",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderDialog(
  isOpen = true,
  onClose = vi.fn(),
  defaultBoardId: string | null = "brd-1",
  defaultColumnId: string | null = "col-1",
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
          <TaskCreateDialog
            isOpen={isOpen}
            onClose={onClose}
            defaultBoardId={defaultBoardId}
            defaultColumnId={defaultColumnId}
          />
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

  it("Save button enables once title is filled (board / column come from props)", async () => {
    setupDefaultMocks();
    const { user } = renderDialog();

    const titleInput = await screen.findByTestId("task-create-dialog-title-input");
    await user.type(titleInput, "My task");

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

  it("fires create_task mutation with payload from props + title", async () => {
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

  it("role listbox renders '(no role)' as first option", async () => {
    setupDefaultMocks();
    renderDialog();

    const roleSelect = await screen.findByTestId("task-create-dialog-role-select");
    expect(roleSelect).toBeInTheDocument();
    expect(screen.getByText("(no role)")).toBeInTheDocument();
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

    // Select the role (second option in the role listbox — first is "(no role)").
    const roleSelect = await screen.findByTestId("task-create-dialog-role-select");
    const roleOptions = roleSelect.querySelectorAll("[role='option']");
    // roleOptions[0] is "(no role)", roleOptions[1] is "Developer".
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
