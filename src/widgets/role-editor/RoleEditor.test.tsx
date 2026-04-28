import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Role } from "@entities/role";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { RoleEditor } from "./RoleEditor";

const invokeMock = vi.mocked(invoke);

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-1",
    name: "Тестовая роль",
    content: "Содержимое роли",
    color: "#ff0000",
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

describe("RoleEditor", () => {
  it("does not render the dialog when roleId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<RoleEditor roleId={null} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    // Never resolves — simulates pending state.
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<RoleEditor roleId="role-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Save button is disabled during loading.
    const saveButton = screen.getByTestId("role-editor-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_role") throw new Error("transport down");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<RoleEditor roleId="role-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("role-editor-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  it("renders form fields populated when loaded", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_role") return makeRole();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<RoleEditor roleId="role-1" onClose={onClose} />);

    await screen.findByTestId("role-editor-name-input");
    expect(screen.getByTestId("role-editor-name-input")).toHaveValue("Тестовая роль");
    expect(screen.getByTestId("role-editor-content-textarea")).toHaveValue("Содержимое роли");
    expect((screen.getByTestId("role-editor-color-input") as HTMLInputElement).value).toBe("#ff0000");
  });

  it("name input is editable", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_role") return makeRole();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<RoleEditor roleId="role-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("role-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    expect(nameInput).toHaveValue("Новое название");
  });

  it("clicking Save triggers useUpdateRoleMutation with dirty fields only", async () => {
    const role = makeRole();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_role") return role;
      if (cmd === "update_role") return { ...role, name: "Новое название" };
      if (cmd === "list_roles") return [role];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<RoleEditor roleId="role-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("role-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    const saveButton = screen.getByTestId("role-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_role");
      expect(updateCall).toBeDefined();
      // Only the name field changed — other fields must NOT be included.
      expect(updateCall?.[1]).toMatchObject({
        id: "role-1",
        name: "Новое название",
      });
      // content / color were not changed, so they must be absent.
      expect(updateCall?.[1]).not.toHaveProperty("content");
      expect(updateCall?.[1]).not.toHaveProperty("color");
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_role") return makeRole();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<RoleEditor roleId="role-1" onClose={onClose} />);

    await screen.findByTestId("role-editor-name-input");
    const cancelButton = screen.getByTestId("role-editor-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_role");
    expect(updateCall).toBeUndefined();
  });

  it("empty color gets sent as null on update", async () => {
    const role = makeRole({ color: "#ff0000" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_role") return role;
      if (cmd === "update_role") return { ...role, color: null };
      if (cmd === "list_roles") return [role];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<RoleEditor roleId="role-1" onClose={onClose} />);

    await screen.findByTestId("role-editor-name-input");

    // Click the "Сбросить" button to clear the color.
    const resetButton = screen.getByText("Сбросить");
    await user.click(resetButton);

    const saveButton = screen.getByTestId("role-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_role");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "role-1",
        color: null,
      });
    });
  });

  it("shows inline save-error message when mutation fails", async () => {
    const role = makeRole();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_role") return role;
      if (cmd === "update_role") throw new Error("сервер недоступен");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<RoleEditor roleId="role-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("role-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Другое название");

    const saveButton = screen.getByTestId("role-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("role-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/сервер недоступен/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
