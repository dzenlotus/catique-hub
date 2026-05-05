import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Board } from "@entities/board";
import type { Space } from "@entities/space";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { BoardEditor } from "./BoardEditor";

const invokeMock = vi.mocked(invoke);

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-1",
    name: "Тестовая доска",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    description: null,
    color: null,
    icon: null,
    ownerRoleId: "maintainer-system",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "spc-1",
    name: "Пространство 1",
    prefix: "sp1",
    description: null,
    color: null,
    icon: null,
    isDefault: true,
    position: 1,
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

describe("BoardEditor", () => {
  it("does not render the dialog when boardId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<BoardEditor boardId={null} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    // Never resolves — simulates pending state.
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    // The dialog should be open.
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Skeleton elements — buttons are disabled during loading.
    const saveButton = screen.getByTestId("board-editor-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the board query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") throw new Error("transport down");
      if (cmd === "list_spaces") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("board-editor-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  it("renders form fields populated when loaded", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    // Wait for loaded state.
    await screen.findByTestId("board-editor-name-input");
    expect(screen.getByTestId("board-editor-name-input")).toHaveValue("Тестовая доска");
    expect(screen.getByTestId("board-editor-position-input")).toHaveValue(1);
    // Space listbox should be present.
    expect(screen.getByTestId("board-editor-space-select")).toBeInTheDocument();
    // Space name should appear in the listbox.
    expect(screen.getByText("Пространство 1")).toBeInTheDocument();
  });

  it("name input is editable", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("board-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    expect(nameInput).toHaveValue("Новое название");
  });

  it("shows validation error when name is empty on save", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("board-editor-name-input");
    await user.clear(nameInput);

    const saveButton = screen.getByTestId("board-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("board-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/name cannot be empty/i)).toBeInTheDocument();
    // update_board should NOT have been called.
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_board");
    expect(updateCall).toBeUndefined();
  });

  it("clicking Save triggers useUpdateBoardMutation with dirty fields only", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      if (cmd === "update_board") return { ...board, name: "Новое название" };
      if (cmd === "list_boards") return [board];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("board-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    const saveButton = screen.getByTestId("board-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_board");
      expect(updateCall).toBeDefined();
      // Only the name field changed — other fields must NOT be included.
      expect(updateCall?.[1]).toMatchObject({
        id: "brd-1",
        name: "Новое название",
      });
      // spaceId and position were not changed, so they must be absent.
      expect(updateCall?.[1]).not.toHaveProperty("spaceId");
      expect(updateCall?.[1]).not.toHaveProperty("position");
    });
  });

  it("clicking Save with changed position sends position in payload", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      if (cmd === "update_board") return { ...board, position: 5 };
      if (cmd === "list_boards") return [board];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    const positionInput = await screen.findByTestId("board-editor-position-input");
    await user.clear(positionInput);
    await user.type(positionInput, "5");

    const saveButton = screen.getByTestId("board-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_board");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({ id: "brd-1", position: 5 });
      expect(updateCall?.[1]).not.toHaveProperty("name");
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    // Wait for loaded state then click cancel.
    await screen.findByTestId("board-editor-name-input");
    const cancelButton = screen.getByTestId("board-editor-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_board");
    expect(updateCall).toBeUndefined();
  });

  it("empty position field sends no position in payload", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      if (cmd === "update_board") return { ...board, name: "Новое" };
      if (cmd === "list_boards") return [board];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("board-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое");

    const positionInput = screen.getByTestId("board-editor-position-input");
    await user.clear(positionInput);

    const saveButton = screen.getByTestId("board-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_board");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).not.toHaveProperty("position");
    });
  });

  it("shows inline error on mutation failure", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      if (cmd === "update_board") throw new Error("server error");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("board-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Изменённое");

    const saveButton = screen.getByTestId("board-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("board-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/failed to save:/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on successful save", async () => {
    const board = makeBoard();
    const space = makeSpace();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return board;
      if (cmd === "list_spaces") return [space];
      if (cmd === "update_board") return { ...board, name: "Сохранено" };
      if (cmd === "list_boards") return [board];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<BoardEditor boardId="brd-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("board-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Сохранено");

    const saveButton = screen.getByTestId("board-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
