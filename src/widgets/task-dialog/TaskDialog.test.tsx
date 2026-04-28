import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Task } from "@entities/task";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { TaskDialog } from "./TaskDialog";

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
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

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
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { client, user };
}

beforeEach(() => {
  invokeMock.mockReset();
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
    // Never resolves — simulates pending state.
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    // The dialog should be open.
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Skeleton elements — buttons are disabled during loading.
    const saveButton = screen.getByTestId("task-dialog-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") throw new Error("transport down");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("task-dialog-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  it("renders form fields populated with task data when loaded", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return makeTask();
      if (cmd === "list_agent_reports") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
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
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return makeTask();
      if (cmd === "list_agent_reports") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    const titleInput = await screen.findByTestId("task-dialog-title-input");
    await user.clear(titleInput);
    await user.type(titleInput, "Новое название");

    expect(titleInput).toHaveValue("Новое название");
  });

  it("clicking Save triggers the update mutation with new values", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "update_task") return { ...task, title: "Обновлённое название" };
      if (cmd === "list_tasks") return [task];
      if (cmd === "list_agent_reports") return [];
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
      if (cmd === "list_agent_reports") return [];
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
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return makeTask();
      if (cmd === "list_agent_reports") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    // Wait for loaded state by waiting for the title input, then get cancel button.
    await screen.findByTestId("task-dialog-title-input");
    const cancelButton = screen.getByTestId("task-dialog-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_task");
    expect(updateCall).toBeUndefined();
  });

  it("renders all three section headers", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return makeTask();
      if (cmd === "list_agent_reports") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("task-dialog-placeholder-prompts")).toBeInTheDocument();
    });
    expect(screen.getByTestId("task-dialog-placeholder-attachments")).toBeInTheDocument();
    expect(screen.getByTestId("task-dialog-placeholder-agent-reports")).toBeInTheDocument();

    // Section headings use the new copy.
    expect(screen.getByText("Прикреплённые промпты")).toBeInTheDocument();
    expect(screen.getByText("Вложения")).toBeInTheDocument();
    expect(screen.getByText("Отчёты агента")).toBeInTheDocument();
  });

  it("prompts section shows empty-state hint with coming-soon note", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return makeTask();
      if (cmd === "list_agent_reports") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("Промпты не прикреплены")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/появится с вслайсом прикрепления промптов E4/i),
    ).toBeInTheDocument();
  });

  it("attachments section shows coming-soon placeholder", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return makeTask();
      if (cmd === "list_agent_reports") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    await waitFor(() => {
      expect(
        screen.getByText(/появится с вслайсом вложений E4/i),
      ).toBeInTheDocument();
    });
  });

  it("agent reports section renders AgentReportsList (empty state by default)", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return makeTask();
      if (cmd === "list_agent_reports") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    // AgentReportsList empty state renders "No reports yet"
    await waitFor(() => {
      expect(screen.getByText(/no reports yet/i)).toBeInTheDocument();
    });
  });

  it("shows inline error when save fails", async () => {
    const task = makeTask();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_task") return task;
      if (cmd === "update_task") throw new Error("db locked");
      if (cmd === "list_agent_reports") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TaskDialog taskId="tsk-1" onClose={onClose} />);

    // Wait for loaded state, then click save.
    await screen.findByTestId("task-dialog-title-input");
    const saveButton = screen.getByTestId("task-dialog-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("task-dialog-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/db locked/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
