import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Role } from "@entities/role";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { RoleCreateDialog } from "./RoleCreateDialog";

const invokeMock = vi.mocked(invoke);

function renderWithClient(
  ui: ReactElement,
): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { user };
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-1",
    name: "Старший инженер",
    content: "",
    color: null,
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

describe("RoleCreateDialog", () => {
  it("renders form fields when open", () => {
    renderWithClient(<RoleCreateDialog isOpen onClose={() => undefined} />);
    expect(
      screen.getByTestId("role-create-dialog-name-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("role-create-dialog-content-textarea"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("role-create-dialog-color-input"),
    ).toBeInTheDocument();
  });

  it("Save button is disabled when name is empty", () => {
    renderWithClient(<RoleCreateDialog isOpen onClose={() => undefined} />);
    expect(screen.getByTestId("role-create-dialog-save")).toBeDisabled();
  });

  it("Save button becomes enabled once name is filled", async () => {
    const { user } = renderWithClient(
      <RoleCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("role-create-dialog-name-input"),
      "Ведущий разработчик",
    );
    expect(screen.getByTestId("role-create-dialog-save")).not.toBeDisabled();
  });

  it("calls create_role with correct payload on submit", async () => {
    const newRole = makeRole({ id: "role-new", name: "Аналитик" });
    invokeMock.mockResolvedValue(newRole);

    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <RoleCreateDialog isOpen onClose={onClose} onCreated={onCreated} />,
    );

    await user.type(
      screen.getByTestId("role-create-dialog-name-input"),
      "Аналитик",
    );
    await user.click(screen.getByTestId("role-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith(newRole);

    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_role",
    );
    expect(createCall?.[1]).toEqual({ name: "Аналитик" });
  });

  it("includes content in payload when filled", async () => {
    const newRole = makeRole();
    invokeMock.mockResolvedValue(newRole);

    const { user } = renderWithClient(
      <RoleCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("role-create-dialog-name-input"),
      "Название",
    );
    await user.type(
      screen.getByTestId("role-create-dialog-content-textarea"),
      "Описание роли",
    );
    await user.click(screen.getByTestId("role-create-dialog-save"));

    await waitFor(() => {
      const createCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "create_role",
      );
      expect(createCall?.[1]).toMatchObject({ content: "Описание роли" });
    });
  });

  it("shows inline error on mutation failure", async () => {
    invokeMock.mockRejectedValue(new Error("сбой"));

    const { user } = renderWithClient(
      <RoleCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("role-create-dialog-name-input"),
      "Название",
    );
    await user.click(screen.getByTestId("role-create-dialog-save"));

    await waitFor(() => {
      expect(screen.getByTestId("role-create-dialog-error")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("Cancel closes without calling the mutation", async () => {
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <RoleCreateDialog isOpen onClose={onClose} />,
    );

    await user.click(screen.getByTestId("role-create-dialog-cancel"));

    expect(onClose).toHaveBeenCalled();
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_role",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("does not render content when isOpen is false", () => {
    renderWithClient(
      <RoleCreateDialog isOpen={false} onClose={() => undefined} />,
    );
    expect(
      screen.queryByTestId("role-create-dialog-name-input"),
    ).toBeNull();
  });
});
