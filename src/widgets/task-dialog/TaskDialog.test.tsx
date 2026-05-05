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

    // 3. Description — round-19c MarkdownField defaults to view mode,
    // so the testid points to the preview button. Assert visible text.
    expect(screen.getByTestId("task-dialog-description-textarea")).toHaveTextContent("Описание задачи");

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
    const { user } = renderWithClient(
      <TaskDialog taskId="tsk-1" onClose={onClose} />,
    );

    await screen.findByTestId("task-dialog-title-input");

    // Round-19c: native <select> replaced by shared RAC <Select>.
    // Assert options by opening the popover and reading role="option".
    const boardTrigger = screen.getByTestId("task-dialog-board-select");
    await user.click(boardTrigger);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Sprint Board" })).toBeInTheDocument();
    });
  });

  it("column select is populated from useColumns(boardId)", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <TaskDialog taskId="tsk-1" onClose={onClose} />,
    );

    await screen.findByTestId("task-dialog-title-input");

    const columnTrigger = screen.getByTestId("task-dialog-column-select");
    await user.click(columnTrigger);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Todo" })).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "In Progress" }),
      ).toBeInTheDocument();
    });
  });

  it("role select includes '(no role)' as first option and loaded roles", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <TaskDialog taskId="tsk-1" onClose={onClose} />,
    );

    await screen.findByTestId("task-dialog-title-input");

    const roleTrigger = screen.getByTestId("task-dialog-role-select");
    await user.click(roleTrigger);
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      const texts = options.map((o) => o.textContent ?? "");
      expect(texts[0]).toBe("(no role)");
      expect(texts).toContain("Dev Agent");
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

    const boardTrigger = screen.getByTestId("task-dialog-board-select");
    const columnTrigger = screen.getByTestId("task-dialog-column-select");

    // Change board to brd-2 by clicking trigger then Board 2 option
    await user.click(boardTrigger);
    await user.click(await screen.findByRole("option", { name: "Board 2" }));

    // Column selection resets to placeholder ("— select —")
    await waitFor(() => {
      expect(columnTrigger).toHaveTextContent("— select —");
    });

    // After cascade, brd-2 columns load — verify by opening column popover
    await user.click(columnTrigger);
    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "New Column" }),
      ).toBeInTheDocument();
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

    // Change column — open trigger, click "In Progress" option
    const columnTrigger = screen.getByTestId("task-dialog-column-select");
    await user.click(columnTrigger);
    await user.click(
      await screen.findByRole("option", { name: "In Progress" }),
    );

    // Set role — open trigger, click "Dev Agent" option
    const roleTrigger = screen.getByTestId("task-dialog-role-select");
    await user.click(roleTrigger);
    await user.click(await screen.findByRole("option", { name: "Dev Agent" }));

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

    // Round-19c: description renders via MarkdownField in view mode by
    // default — assert visible text instead of textarea `value`.
    expect(screen.getByTestId("task-dialog-description-textarea")).toHaveTextContent("Описание задачи");
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
    expect(screen.getByText("Attachments")).toBeInTheDocument();
    expect(screen.getByText("Agent reports")).toBeInTheDocument();
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
      expect(screen.getByText("No attachments")).toBeInTheDocument();
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
      expect(
        screen.getByText(/failed to load attachments/i),
      ).toBeInTheDocument();
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

  it("upload button: file picker filter does not use the literal '*' extension (audit F-13)", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    dialogOpenMock.mockResolvedValue(null);

    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    const uploadBtn = await screen.findByTestId("task-dialog-upload-btn");
    await user.click(uploadBtn);

    expect(dialogOpenMock).toHaveBeenCalledOnce();
    const callArgs = dialogOpenMock.mock.calls[0]?.[0] as
      | { filters?: Array<{ extensions: string[] }> }
      | undefined;
    // Either no filters at all (default = all files) or a real list —
    // never `["*"]` which Tauri v2's dialog plugin treats as a literal
    // extension and hides every file from the picker.
    if (callArgs?.filters !== undefined) {
      for (const filter of callArgs.filters) {
        expect(filter.extensions).not.toContain("*");
        expect(filter.extensions.length).toBeGreaterThan(0);
      }
    }
  });

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
      expect(screen.getByText("File uploaded")).toBeInTheDocument();
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
        screen.getByText(/failed to upload file/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/disk full/i)).toBeInTheDocument();
  });

  // ── Attach prompt action (ctq-102) ─────────────────────────────────

  it("opens AttachPromptDialog with locked task target on Attach prompt", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(defaultInvokeHandler(task));
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <TaskDialog taskId="tsk-1" onClose={onClose} />,
    );

    const attachBtn = await screen.findByTestId("task-dialog-prompts-attach");
    await user.click(attachBtn);

    await waitFor(() => {
      expect(screen.getByTestId("attach-prompt-dialog")).toBeInTheDocument();
    });
    // Locked target — kind/target pickers suppressed.
    expect(
      screen.getByTestId("attach-prompt-dialog-locked-target"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("attach-prompt-dialog-target-kind"),
    ).not.toBeInTheDocument();
  });
});
