import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Column } from "@entities/column";
import type { Role } from "@entities/role";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { ColumnEditor } from "./ColumnEditor";

const invokeMock = vi.mocked(invoke);

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-1",
    boardId: "brd-1",
    name: "In Progress",
    position: 2n,
    roleId: null,
    createdAt: 0n,
    ...overrides,
  };
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-1",
    name: "Разработчик",
    content: "",
    color: null,
    isSystem: false,
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

describe("ColumnEditor", () => {
  it("does not render the dialog when columnId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<ColumnEditor columnId={null} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    // Never resolves — simulates pending state.
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    // The dialog should be open.
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Buttons are disabled during loading.
    const saveButton = screen.getByTestId("column-editor-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the column query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_column") throw new Error("transport down");
      if (cmd === "list_roles") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("column-editor-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  it("renders form fields populated when loaded", async () => {
    const column = makeColumn();
    const role = makeRole();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_column") return column;
      if (cmd === "list_roles") return [role];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    // Wait for loaded state.
    await screen.findByTestId("column-editor-name-input");
    expect(screen.getByTestId("column-editor-name-input")).toHaveValue("In Progress");
    expect(screen.getByTestId("column-editor-position-input")).toHaveValue(2);
    // Role listbox should be present.
    expect(screen.getByTestId("column-editor-role-select")).toBeInTheDocument();
    // "(нет роли)" option should appear (column has no role).
    expect(screen.getByText("(нет роли)")).toBeInTheDocument();
    // The role name should also appear in the list.
    expect(screen.getByText("Разработчик")).toBeInTheDocument();
  });

  it("name input is editable", async () => {
    const column = makeColumn();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_column") return column;
      if (cmd === "list_roles") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("column-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Готово");

    expect(nameInput).toHaveValue("Готово");
  });

  it("shows validation error when name is empty on save", async () => {
    const column = makeColumn();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_column") return column;
      if (cmd === "list_roles") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("column-editor-name-input");
    await user.clear(nameInput);

    const saveButton = screen.getByTestId("column-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("column-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/название не может быть пустым/i)).toBeInTheDocument();
    // update_column should NOT have been called.
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_column");
    expect(updateCall).toBeUndefined();
  });

  it("clicking Save with changed name sends only name in payload (dirty-only)", async () => {
    const column = makeColumn();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_column") return column;
      if (cmd === "list_roles") return [];
      if (cmd === "update_column") return { ...column, name: "Новое название" };
      if (cmd === "list_columns") return [column];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("column-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    const saveButton = screen.getByTestId("column-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_column");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({ id: "col-1", name: "Новое название" });
      // position was not changed, so it must be absent.
      expect(updateCall?.[1]).not.toHaveProperty("position");
      // roleId was not changed, so it must be absent.
      expect(updateCall?.[1]).not.toHaveProperty("roleId");
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    const column = makeColumn();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_column") return column;
      if (cmd === "list_roles") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    // Wait for loaded state then click cancel.
    await screen.findByTestId("column-editor-name-input");
    const cancelButton = screen.getByTestId("column-editor-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_column");
    expect(updateCall).toBeUndefined();
  });

  it("closes and shows success toast on successful save", async () => {
    const column = makeColumn();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_column") return column;
      if (cmd === "list_roles") return [];
      if (cmd === "update_column") return { ...column, name: "Сохранено" };
      if (cmd === "list_columns") return [column];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("column-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Сохранено");

    const saveButton = screen.getByTestId("column-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("shows inline error and toast on mutation failure", async () => {
    const column = makeColumn();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_column") return column;
      if (cmd === "list_roles") return [];
      if (cmd === "update_column") throw new Error("server error");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<ColumnEditor columnId="col-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("column-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Изменённое");

    const saveButton = screen.getByTestId("column-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("column-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/не удалось сохранить/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
