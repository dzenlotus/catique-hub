import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Task } from "@entities/task";
import { ToastProvider } from "@app/providers/ToastProvider";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { invoke } from "@shared/api";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { TaskDialog } from "./TaskDialog";

const dialogOpenMock = vi.mocked(dialogOpen);
const invokeMock = vi.mocked(invoke);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk-1",
    boardId: "brd-1",
    columnId: "col-1",
    slug: "tsk-abc",
    title: "Тестовая задача",
    description: "Описание задачи",
    position: 1,
    roleId: null,
    stepLog: "",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const makeBoard = (id: string, name: string, spaceId = "spc-1") => ({
  id,
  name,
  spaceId,
  roleId: null,
  position: 1,
  description: null,
  ownerRoleId: "maintainer-system",
  createdAt: 0n,
  updatedAt: 0n,
});

const makeColumn = (id: string, name: string, boardId: string) => ({
  id,
  name,
  boardId,
  position: 1n,
  roleId: null,
  createdAt: 0n,
});

const makeRole = (id: string, name: string) => ({
  id,
  name,
  content: "",
  color: null,
  isSystem: false,
  createdAt: 0n,
  updatedAt: 0n,
});

const makeSpace = (id = "spc-1") => ({
  id,
  name: "Пространство",
  isDefault: true,
  createdAt: 0n,
  updatedAt: 0n,
});

import { Toaster } from "@widgets/toaster";

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ActiveSpaceProvider>
        <ToastProvider>
          {ui}
          <Toaster />
        </ToastProvider>
      </ActiveSpaceProvider>
    </QueryClientProvider>,
  );
  return { client, user };
}

/** Default mock handler for all common IPC commands. */
function defaultInvokeHandler(
  task: Task,
  extra: Record<string, unknown> = {},
): (cmd: string) => Promise<unknown> {
  return async (cmd: string) => {
    if (cmd === "get_task") return task;
    if (cmd === "list_attachments") return [];
    if (cmd === "list_agent_reports") return [];
    if (cmd === "list_task_prompts") return [];
    if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
    // list_columns returns ALL columns (client filters by boardId in columnsApi)
    if (cmd === "list_columns") return [
      makeColumn("col-1", "Todo", "brd-1"),
      makeColumn("col-2", "In Progress", "brd-1"),
    ];
    if (cmd === "list_roles") return [makeRole("role-1", "Dev Agent")];
    if (cmd === "list_spaces") return [makeSpace()];
    if (cmd in extra) return extra[cmd];
    throw new Error(`unexpected: ${cmd}`);
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  dialogOpenMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskDialog", () => {
  it("does not render the dialog when taskId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId={null} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const saveButton = screen.getByTestId("task-dialog-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") throw new Error("transport down");
      if (cmd === "list_boards") return [];
      if (cmd === "list_columns") return [];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("task-dialog-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  // ── v1 fields rendering ──────────────────────────────────────────

  it("renders all 7 v1 fields in loaded state", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    // 1. Title input
    const titleInput = await screen.findByTestId("task-dialog-title-input");
    expect(titleInput).toBeInTheDocument();
    expect(titleInput).toHaveValue("Тестовая задача");

    // 2. Slug chip
    expect(screen.getByTestId("task-dialog-slug-chip")).toHaveTextContent("tsk-abc");

    // 3. Description textarea
    expect(screen.getByTestId("task-dialog-description-textarea")).toHaveValue("Описание задачи");

    // 4. Board select
    expect(screen.getByTestId("task-dialog-board-select")).toBeInTheDocument();

    // 5. Column/Status select
    expect(screen.getByTestId("task-dialog-column-select")).toBeInTheDocument();

    // 6. Role select
    expect(screen.getByTestId("task-dialog-role-select")).toBeInTheDocument();

    // 7. Attached prompts section
    expect(screen.getByTestId("task-dialog-prompts-section")).toBeInTheDocument();
  });

  it("board select is populated with boards from active space", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");

    const boardSelect = screen.getByTestId("task-dialog-board-select") as HTMLSelectElement;
    // Board option visible
    await waitFor(() => {
      expect(boardSelect.options.length).toBeGreaterThan(0);
      const optionTexts = Array.from(boardSelect.options).map((o) => o.text);
      expect(optionTexts).toContain("Sprint Board");
    });
  });

  it("column select is populated from useColumns(boardId)", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");

    const columnSelect = screen.getByTestId("task-dialog-column-select") as HTMLSelectElement;
    await waitFor(() => {
      const optionTexts = Array.from(columnSelect.options).map((o) => o.text);
      expect(optionTexts).toContain("Todo");
      expect(optionTexts).toContain("In Progress");
    });
  });

  it("role select includes '(нет роли)' as first option and loaded roles", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");

    const roleSelect = screen.getByTestId("task-dialog-role-select") as HTMLSelectElement;
    await waitFor(() => {
      const optionTexts = Array.from(roleSelect.options).map((o) => o.text);
      expect(optionTexts[0]).toBe("(нет роли)");
      expect(optionTexts).toContain("Dev Agent");
    });
  });

  // ── Board → Column cascade ───────────────────────────────────────

  it("changing Board resets column selection and fetches columns for new board", async () => {
    const task = makeTask();
    // list_columns returns ALL columns (client-side filtering by boardId happens in columnsApi)
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [
        makeBoard("brd-1", "Board 1"),
        makeBoard("brd-2", "Board 2"),
      ];
      if (cmd === "list_columns") return [
        makeColumn("col-1", "Todo", "brd-1"),
        makeColumn("col-x", "New Column", "brd-2"),
      ];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");

    const boardSelect = screen.getByTestId("task-dialog-board-select") as HTMLSelectElement;
    const columnSelect = screen.getByTestId("task-dialog-column-select") as HTMLSelectElement;

    // Change board to brd-2
    await user.selectOptions(boardSelect, "brd-2");

    // Column selection should reset (value becomes "")
    await waitFor(() => {
      expect(columnSelect.value).toBe("");
    });

    // After cascade, brd-2 columns load
    await waitFor(() => {
      const optionTexts = Array.from(columnSelect.options).map((o) => o.text);
      expect(optionTexts).toContain("New Column");
    });
  });

  // ── Save mutation payload ────────────────────────────────────────

  it("clicking Save fires the mutation with all dirty fields (title, columnId, roleId)", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "update_task") return { ...task, title: "Updated" };
      if (cmd === "list_tasks") return [task];
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [
        makeColumn("col-1", "Todo", "brd-1"),
        makeColumn("col-2", "In Progress", "brd-1"),
      ];
      if (cmd === "list_roles") return [makeRole("role-1", "Dev Agent")];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    const titleInput = await screen.findByTestId("task-dialog-title-input");
    await user.clear(titleInput);
    await user.type(titleInput, "Обновлённое название");

    // Change column
    const columnSelect = screen.getByTestId("task-dialog-column-select") as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(columnSelect.options).map((o) => o.value)).toContain("col-2");
    });
    await user.selectOptions(columnSelect, "col-2");

    // Set role
    const roleSelect = screen.getByTestId("task-dialog-role-select") as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(roleSelect.options).map((o) => o.value)).toContain("role-1");
    });
    await user.selectOptions(roleSelect, "role-1");

    const saveButton = screen.getByTestId("task-dialog-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_task");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "tsk-1",
        title: "Обновлённое название",
        columnId: "col-2",
        roleId: "role-1",
      });
    });
  });

  it("Save with no changes only sends id + boardId (no dirty fields)", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "update_task") return task;
      if (cmd === "list_tasks") return [task];
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");
    const saveButton = screen.getByTestId("task-dialog-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_task");
      expect(updateCall).toBeDefined();
      // No extra dirty fields
      const payload = updateCall?.[1] as Record<string, unknown>;
      expect(payload.title).toBeUndefined();
      expect(payload.columnId).toBeUndefined();
      expect(payload.roleId).toBeUndefined();
    });
  });

  // ── Trash / delete flow ──────────────────────────────────────────

  it("trash button shows inline confirmation", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");

    const deleteBtn = screen.getByTestId("task-dialog-delete-btn");
    await user.click(deleteBtn);

    expect(screen.getByTestId("task-dialog-delete-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("task-dialog-delete-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("task-dialog-delete-confirm-btn")).toBeInTheDocument();
    // Trash button itself is gone while confirming
    expect(screen.queryByTestId("task-dialog-delete-btn")).not.toBeInTheDocument();
  });

  it("cancelling delete confirmation restores trash button", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");

    await user.click(screen.getByTestId("task-dialog-delete-btn"));
    expect(screen.getByTestId("task-dialog-delete-confirm")).toBeInTheDocument();

    await user.click(screen.getByTestId("task-dialog-delete-cancel"));
    expect(screen.queryByTestId("task-dialog-delete-confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-dialog-delete-btn")).toBeInTheDocument();
  });

  it("confirming delete calls delete mutation and closes dialog", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "delete_task") return undefined;
      if (cmd === "list_tasks") return [];
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");
    await user.click(screen.getByTestId("task-dialog-delete-btn"));
    await user.click(screen.getByTestId("task-dialog-delete-confirm-btn"));

    await waitFor(() => {
      const deleteCall = invokeMock.mock.calls.find(([cmd]) => cmd === "delete_task");
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[1]).toMatchObject({ id: "tsk-1" });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  // ── Existing stable tests ────────────────────────────────────────

  it("renders form fields populated with task data when loaded", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask()));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("task-dialog-title-input")).toBeInTheDocument();
    });
    const titleInput = screen.getByTestId("task-dialog-title-input");
    expect(titleInput).toHaveValue("Тестовая задача");

    const descriptionTextarea = screen.getByTestId("task-dialog-description-textarea");
    expect(descriptionTextarea).toHaveValue("Описание задачи");
  });

  it("title input is editable", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask()));
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    const titleInput = await screen.findByTestId("task-dialog-title-input");
    await user.clear(titleInput);
    await user.type(titleInput, "Новое название");

    expect(titleInput).toHaveValue("Новое название");
  });

  it("clicking Save triggers the update mutation with new title", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "update_task") return { ...task, title: "Обновлённое название" };
      if (cmd === "list_tasks") return [task];
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    const titleInput = await screen.findByTestId("task-dialog-title-input");
    await user.clear(titleInput);
    await user.type(titleInput, "Обновлённое название");

    const saveButton = screen.getByTestId("task-dialog-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_task");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "tsk-1",
        title: "Обновлённое название",
      });
    });
  });

  it("clicking Save closes the dialog on success", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "update_task") return task;
      if (cmd === "list_tasks") return [task];
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");
    const saveButton = screen.getByTestId("task-dialog-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask()));
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");
    const cancelButton = screen.getByTestId("task-dialog-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_task");
    expect(updateCall).toBeUndefined();
  });

  it("renders all three section headers", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask()));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("task-dialog-prompts-section")).toBeInTheDocument();
    });
    expect(screen.getByTestId("task-dialog-placeholder-attachments")).toBeInTheDocument();
    expect(screen.getByTestId("task-dialog-placeholder-agent-reports")).toBeInTheDocument();

    expect(screen.getByText("Attached prompts")).toBeInTheDocument();
    expect(screen.getByText("Вложения")).toBeInTheDocument();
    expect(screen.getByText("Отчёты агента")).toBeInTheDocument();
  });

  it("prompts section shows empty-state hint when no prompts attached", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask()));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("No prompts attached")).toBeInTheDocument();
    });
  });

  it("attachments section shows empty state with enabled upload button when no attachments", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask()));
    dialogOpenMock.mockResolvedValue(null);
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("Нет вложений")).toBeInTheDocument();
    });

    const uploadBtn = screen.getByTestId("task-dialog-upload-btn");
    expect(uploadBtn).not.toBeDisabled();
  });

  it("attachments section renders attachment rows when attachments exist", async () => {
    const task = makeTask();
    const attachment = {
      id: "att-1",
      taskId: task.id,
      filename: "design.png",
      mimeType: "image/png",
      sizeBytes: 2048n,
      storagePath: "/attachments/tsk-1/design.png",
      uploadedAt: 0n,
      uploadedBy: null,
    };
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "list_attachments") return [attachment];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("attachment-row-att-1")).toBeInTheDocument();
    });
    expect(screen.getByText("design.png")).toBeInTheDocument();
  });

  it("attachments section delete button calls delete mutation and shows success toast", async () => {
    const task = makeTask();
    const attachment = {
      id: "att-del",
      taskId: task.id,
      filename: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024n,
      storagePath: "/attachments/tsk-1/notes.pdf",
      uploadedAt: 0n,
      uploadedBy: null,
    };
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "list_attachments") return [attachment];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "delete_attachment") return undefined;
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("attachment-row-att-del")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("attachment-row-delete-att-del"));

    await waitFor(() => {
      const deleteCall = invokeMock.mock.calls.find(([cmd]) => cmd === "delete_attachment");
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[1]).toMatchObject({ id: "att-del" });
    });
  });

  it("attachments section shows error banner when list query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return makeTask();
      if (cmd === "list_attachments") throw new Error("attachments down");
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/не удалось загрузить вложения/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/attachments down/i)).toBeInTheDocument();
  });

  it("agent reports section renders AgentReportsList (empty state by default)", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask()));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/no reports yet/i)).toBeInTheDocument();
    });
  });

  // ── Implicit view ⇄ edit (MarkdownField, ctq-76 #11) ───────────────

  it("does NOT render an explicit description mode toggle (round-19c MarkdownField)", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask()));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");

    // The two-button Edit / Preview toggle is gone — view ⇄ edit
    // is implicit via `MarkdownField` (click / focus / blur).
    expect(screen.queryByTestId("task-dialog-description-mode-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-dialog-description-textarea")).toBeInTheDocument();
  });

  it("renders markdown description by default and flips to textarea on click", async () => {
    invokeMock.mockImplementation(defaultInvokeHandler(makeTask({ description: "**Жирный** текст" })));
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");

    // Default mode is "view" — bold text is rendered through MarkdownPreview.
    expect(screen.getByText("Жирный").tagName).toBe("STRONG");

    // Click the view surface; the same testid now points to a textarea.
    await user.click(screen.getByTestId("task-dialog-description-textarea"));
    const textarea = screen.getByTestId("task-dialog-description-textarea");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue("**Жирный** текст");
  });

  it("shows inline error when save fails", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "update_task") throw new Error("db locked");
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await screen.findByTestId("task-dialog-title-input");
    const saveButton = screen.getByTestId("task-dialog-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("task-dialog-save-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("task-dialog-save-error")).toHaveTextContent(/db locked/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Upload flow ──────────────────────────────────────────────────

  it("upload button calls dialog open and then upload_attachment IPC on success", async () => {
    const task = makeTask();
    const newAttachment = {
      id: "att-new",
      taskId: task.id,
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4096n,
      storagePath: "att-new_report.pdf",
      uploadedAt: 0n,
      uploadedBy: null,
    };
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "upload_attachment") return newAttachment;
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    dialogOpenMock.mockResolvedValue("/home/user/report.pdf");

    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    const uploadBtn = await screen.findByTestId("task-dialog-upload-btn");
    await user.click(uploadBtn);

    await waitFor(() => {
      const uploadCall = invokeMock.mock.calls.find(([cmd]) => cmd === "upload_attachment");
      expect(uploadCall).toBeDefined();
      expect(uploadCall?.[1]).toMatchObject({
        taskId: "tsk-1",
        sourcePath: "/home/user/report.pdf",
        originalFilename: "report.pdf",
        mimeType: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Файл загружен")).toBeInTheDocument();
    });
  });

  it("upload button: cancel (open returns null) does not invoke upload_attachment", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    dialogOpenMock.mockResolvedValue(null);

    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    const uploadBtn = await screen.findByTestId("task-dialog-upload-btn");
    await user.click(uploadBtn);

    await new Promise((r) => setTimeout(r, 50));

    const uploadCall = invokeMock.mock.calls.find(([cmd]) => cmd === "upload_attachment");
    expect(uploadCall).toBeUndefined();
  });

  it("upload button shows error toast when upload_attachment IPC fails", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "list_attachments") return [];
      if (cmd === "list_agent_reports") return [];
      if (cmd === "list_task_prompts") return [];
      if (cmd === "upload_attachment") throw new Error("disk full");
      if (cmd === "list_boards") return [makeBoard("brd-1", "Sprint Board")];
      if (cmd === "list_columns") return [makeColumn("col-1", "Todo", "brd-1")];
      if (cmd === "list_roles") return [];
      if (cmd === "list_spaces") return [makeSpace()];
      throw new Error(`unexpected: ${cmd}`);
    });
    dialogOpenMock.mockResolvedValue("/tmp/photo.png");

    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    const uploadBtn = await screen.findByTestId("task-dialog-upload-btn");
    await user.click(uploadBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/не удалось загрузить файл/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/disk full/i)).toBeInTheDocument();
  });
});
