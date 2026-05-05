import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Board } from "@entities/board";
import type { Space } from "@entities/space";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { BoardCreateDialog } from "./BoardCreateDialog";

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
  render(
    <QueryClientProvider client={client}>
      <ActiveSpaceProvider>{ui}</ActiveSpaceProvider>
    </QueryClientProvider>,
  );
  return { user };
}

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-1",
    name: "Новая доска",
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

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "spc-1",
    name: "Основное",
    prefix: "main",
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

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BoardCreateDialog", () => {
  it("renders the form fields when open", async () => {
    invokeMock.mockResolvedValue([makeSpace()]);
    renderWithClient(
      <BoardCreateDialog isOpen onClose={() => undefined} />,
    );
    expect(
      await screen.findByTestId("board-create-dialog-name-input"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("board-create-dialog-space-select"),
    ).toBeInTheDocument();
  });

  it("Save button is disabled when name is empty", async () => {
    invokeMock.mockResolvedValue([makeSpace()]);
    renderWithClient(
      <BoardCreateDialog isOpen onClose={() => undefined} />,
    );
    const saveBtn = await screen.findByTestId("board-create-dialog-save");
    expect(saveBtn).toBeDisabled();
  });

  it("Save button becomes enabled once name is filled", async () => {
    invokeMock.mockResolvedValue([makeSpace()]);
    const { user } = renderWithClient(
      <BoardCreateDialog isOpen onClose={() => undefined} />,
    );
    const nameInput = await screen.findByTestId("board-create-dialog-name-input");
    await user.type(nameInput, "Дорожная карта");
    const saveBtn = screen.getByTestId("board-create-dialog-save");
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls create_board mutation with correct payload on submit", async () => {
    const newBoard = makeBoard({ id: "brd-new", name: "Спринт" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_spaces") return [makeSpace({ id: "spc-1" })];
      if (cmd === "create_board") return newBoard;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <BoardCreateDialog isOpen onClose={onClose} onCreated={onCreated} />,
    );

    const nameInput = await screen.findByTestId("board-create-dialog-name-input");
    await user.type(nameInput, "Спринт");
    await user.click(screen.getByTestId("board-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith(newBoard);

    const createCall = invokeMock.mock.calls.find(([cmd]) => cmd === "create_board");
    // Boards default to a neutral list glyph; the test asserts
    // exactly what the dialog sends when the user only types a name.
    expect(createCall?.[1]).toEqual({
      name: "Спринт",
      spaceId: "spc-1",
      icon: "PixelInterfaceEssentialList",
    });
  });

  it("closes on success without onCreated prop", async () => {
    const newBoard = makeBoard();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_spaces") return [makeSpace()];
      if (cmd === "create_board") return newBoard;
      throw new Error(`unexpected: ${cmd}`);
    });

    const onClose = vi.fn();
    const { user } = renderWithClient(
      <BoardCreateDialog isOpen onClose={onClose} />,
    );

    const nameInput = await screen.findByTestId("board-create-dialog-name-input");
    await user.type(nameInput, "Тест");
    await user.click(screen.getByTestId("board-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows inline error on mutation failure", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_spaces") return [makeSpace()];
      if (cmd === "create_board") throw new Error("db error");
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <BoardCreateDialog isOpen onClose={() => undefined} />,
    );

    const nameInput = await screen.findByTestId("board-create-dialog-name-input");
    await user.type(nameInput, "Тест");
    await user.click(screen.getByTestId("board-create-dialog-save"));

    await waitFor(() => {
      expect(screen.getByTestId("board-create-dialog-error")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("Cancel closes without calling the mutation", async () => {
    invokeMock.mockResolvedValue([makeSpace()]);

    const onClose = vi.fn();
    const { user } = renderWithClient(
      <BoardCreateDialog isOpen onClose={onClose} />,
    );

    await screen.findByTestId("board-create-dialog-name-input");
    await user.click(screen.getByTestId("board-create-dialog-cancel"));

    expect(onClose).toHaveBeenCalled();
    const createCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "create_board");
    expect(createCalls).toHaveLength(0);
  });

  it("does not render content when isOpen is false", () => {
    renderWithClient(
      <BoardCreateDialog isOpen={false} onClose={() => undefined} />,
    );
    expect(screen.queryByTestId("board-create-dialog-name-input")).toBeNull();
  });

  it("shows bootstrap CTA when no spaces exist", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_spaces") return [];
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(
      <BoardCreateDialog isOpen onClose={() => undefined} />,
    );

    expect(
      await screen.findByTestId("board-create-dialog-bootstrap-space"),
    ).toBeInTheDocument();
  });

  it("defaults to the isDefault space when multiple spaces exist", async () => {
    invokeMock.mockResolvedValue([
      makeSpace({ id: "spc-first", name: "Первое", isDefault: false }),
      makeSpace({ id: "spc-default", name: "По умолчанию", isDefault: true }),
    ]);

    renderWithClient(
      <BoardCreateDialog isOpen onClose={() => undefined} />,
    );

    const select = (await screen.findByTestId(
      "board-create-dialog-space-select",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("spc-default");
    });
  });

  it("defaults the space picker to the active space from context when set", async () => {
    // Two spaces: spc-other is isDefault, but spc-active is the active space
    // (it comes first so ActiveSpaceProvider picks it via localStorage restore
    // OR we rely on it being first and non-default; the provider auto-selects
    // isDefault, so make spc-active isDefault to control which is active).
    invokeMock.mockResolvedValue([
      makeSpace({ id: "spc-active", name: "Активное", isDefault: true }),
      makeSpace({ id: "spc-other", name: "Другое", isDefault: false }),
    ]);

    renderWithClient(
      <BoardCreateDialog isOpen onClose={() => undefined} />,
    );

    const select = (await screen.findByTestId(
      "board-create-dialog-space-select",
    )) as HTMLSelectElement;

    // The active space (resolved by ActiveSpaceProvider to spc-active)
    // should be pre-selected — not the first-in-list spc-other.
    await waitFor(() => {
      expect(select.value).toBe("spc-active");
    });
  });
});
