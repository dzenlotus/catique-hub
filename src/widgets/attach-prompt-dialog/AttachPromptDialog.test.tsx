import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { AttachPromptDialog } from "./AttachPromptDialog";

const invokeMock = vi.mocked(invoke);

// ── Test fixtures ─────────────────────────────────────────────────────────────

const BOARD = {
  id: "brd-1",
  name: "Доска Альфа",
  spaceId: "sp-1",
  roleId: null,
  position: 1,
  createdAt: 0n,
  updatedAt: 0n,
};
const COLUMN = {
  id: "col-1",
  boardId: "brd-1",
  name: "Бэклог",
  position: 1n,
  roleId: null,
  createdAt: 0n,
  updatedAt: 0n,
};
const ROLE = {
  id: "rol-1",
  name: "Разработчик",
  content: "",
  color: null,
  createdAt: 0n,
  updatedAt: 0n,
};
const PROMPT = {
  id: "prm-1",
  name: "Системный промпт",
  content: "Ты полезный ассистент.",
  color: null,
  shortDescription: null,
  tokenCount: null,
  createdAt: 0n,
  updatedAt: 0n,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { user };
}

/**
 * Default invoke mock: returns entity lists synchronously,
 * resolves attach mutations as void.
 */
function setupDefaultInvokes(): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "list_boards":
        return [BOARD];
      case "list_columns":
        return [COLUMN];
      case "list_tasks":
        return [];
      case "list_roles":
        return [ROLE];
      case "list_prompts":
        return [PROMPT];
      case "add_board_prompt":
        return undefined;
      case "add_column_prompt":
        return undefined;
      case "add_task_prompt":
        return undefined;
      case "add_role_prompt":
        return undefined;
      default:
        return undefined;
    }
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  setupDefaultInvokes();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper: select an item from a RAC Combobox by label name and item text ───

async function selectComboboxItem(
  user: ReturnType<typeof userEvent.setup>,
  comboboxLabel: string,
  itemText: string,
): Promise<void> {
  const cb = screen.getByRole("combobox", { name: comboboxLabel });
  cb.focus();
  // ArrowDown opens popover in RAC Combobox
  await user.keyboard("{ArrowDown}");
  // Wait for the popover listbox to appear
  const listbox = await screen.findByRole("listbox");
  expect(listbox).toBeInTheDocument();
  // Click the matching option
  const option = screen.getByRole("option", { name: new RegExp(itemText, "i") });
  await user.click(option);
  // Wait for popover to close
  await waitFor(() => {
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AttachPromptDialog", () => {
  it("does not render content when isOpen is false", () => {
    renderWithClient(
      <AttachPromptDialog isOpen={false} onClose={() => undefined} />,
    );
    expect(
      screen.queryByTestId("attach-prompt-dialog-target-kind"),
    ).toBeNull();
  });

  it("renders all 4 target-kind radio options when open", () => {
    renderWithClient(<AttachPromptDialog isOpen onClose={() => undefined} />);
    const group = screen.getByTestId("attach-prompt-dialog-target-kind");
    expect(group).toBeInTheDocument();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);

    const labels = radios.map((r) => r.closest("label")?.textContent?.trim());
    expect(labels).toContain("Board");
    expect(labels).toContain("Column");
    expect(labels).toContain("Task");
    expect(labels).toContain("Role");
  });

  it("defaults to 'Board' radio checked", () => {
    renderWithClient(<AttachPromptDialog isOpen onClose={() => undefined} />);
    const boardRadio = screen.getByDisplayValue("board");
    expect(boardRadio).toBeChecked();
  });

  it("switching to 'Column' renders board and column comboboxes", async () => {
    const { user } = renderWithClient(
      <AttachPromptDialog isOpen onClose={() => undefined} />,
    );
    await user.click(screen.getByDisplayValue("column"));
    // Both the board and column comboboxes should be present
    expect(
      screen.getByRole("combobox", { name: "Board" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Column" }),
    ).toBeInTheDocument();
  });

  it("switching to 'Task' renders board and task comboboxes", async () => {
    const { user } = renderWithClient(
      <AttachPromptDialog isOpen onClose={() => undefined} />,
    );
    await user.click(screen.getByDisplayValue("task"));
    expect(
      screen.getByRole("combobox", { name: "Board" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Task" }),
    ).toBeInTheDocument();
  });

  it("switching to 'Role' renders role combobox", async () => {
    const { user } = renderWithClient(
      <AttachPromptDialog isOpen onClose={() => undefined} />,
    );
    await user.click(screen.getByDisplayValue("role"));
    expect(
      screen.getByRole("combobox", { name: "Role" }),
    ).toBeInTheDocument();
  });

  it("Save button is disabled until board and prompt are selected", () => {
    renderWithClient(<AttachPromptDialog isOpen onClose={() => undefined} />);
    expect(screen.getByTestId("attach-prompt-dialog-save")).toBeDisabled();
  });

  it("Cancel closes without calling any attach mutation", async () => {
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <AttachPromptDialog isOpen onClose={onClose} />,
    );

    await user.click(screen.getByTestId("attach-prompt-dialog-cancel"));

    expect(onClose).toHaveBeenCalled();
    const attachCalls = invokeMock.mock.calls.filter(([cmd]) =>
      (cmd as string).startsWith("add_"),
    );
    expect(attachCalls).toHaveLength(0);
  });

  it("board attach: selecting board + prompt + Save fires add_board_prompt", async () => {
    const onAttached = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <AttachPromptDialog isOpen onClose={onClose} onAttached={onAttached} />,
    );

    // Wait for boards to load
    // wait for lists to resolve (invoke is async; react-query will have called list_boards by now)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });

    await selectComboboxItem(user, "Board", "Доска Альфа");
    await selectComboboxItem(user, "Prompt", "Системный промпт");

    await waitFor(() => {
      expect(
        screen.getByTestId("attach-prompt-dialog-save"),
      ).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("attach-prompt-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onAttached).toHaveBeenCalled();

    const addCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "add_board_prompt",
    );
    expect(addCall).toBeDefined();
    expect(addCall?.[1]).toMatchObject({
      boardId: BOARD.id,
      promptId: PROMPT.id,
    });
  });

  it("column attach: selecting board → column → prompt + Save fires add_column_prompt", async () => {
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <AttachPromptDialog isOpen onClose={onClose} />,
    );

    // Switch to column kind
    await user.click(screen.getByDisplayValue("column"));

    // Wait for boards to load
    // wait for lists to resolve (invoke is async; react-query will have called list_boards by now)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });

    await selectComboboxItem(user, "Board", "Доска Альфа");

    // Wait for column combobox to be enabled
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Column" }),
      ).not.toBeDisabled();
    });

    await selectComboboxItem(user, "Column", "Бэклог");
    await selectComboboxItem(user, "Prompt", "Системный промпт");

    await waitFor(() => {
      expect(
        screen.getByTestId("attach-prompt-dialog-save"),
      ).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("attach-prompt-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const addCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "add_column_prompt",
    );
    expect(addCall).toBeDefined();
    expect(addCall?.[1]).toMatchObject({
      columnId: COLUMN.id,
      promptId: PROMPT.id,
    });
  });

  it("closes after a successful attach", async () => {
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <AttachPromptDialog isOpen onClose={onClose} />,
    );

    // wait for lists to resolve (invoke is async; react-query will have called list_boards by now)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });

    await selectComboboxItem(user, "Board", "Доска Альфа");
    await selectComboboxItem(user, "Prompt", "Системный промпт");

    await waitFor(() => {
      expect(
        screen.getByTestId("attach-prompt-dialog-save"),
      ).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("attach-prompt-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ── ctq-89: defaultTarget + lockedTarget ────────────────────────────────

  it("renders target dropdown by default (no defaultTarget, no lock)", () => {
    renderWithClient(<AttachPromptDialog isOpen onClose={() => undefined} />);
    // Free mode — kind radios and the target section both rendered.
    expect(
      screen.getByTestId("attach-prompt-dialog-target-kind"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("attach-prompt-dialog-target"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("attach-prompt-dialog-locked-target"),
    ).toBeNull();
  });

  it("hides dropdown when lockedTarget is true and uses defaultTarget on submit", async () => {
    const onClose = vi.fn();
    const onAttached = vi.fn();
    const { user } = renderWithClient(
      <AttachPromptDialog
        isOpen
        onClose={onClose}
        onAttached={onAttached}
        defaultTarget={{ kind: "role", id: ROLE.id }}
        lockedTarget
      />,
    );

    // Kind radios + cascading pickers must be hidden.
    expect(
      screen.queryByTestId("attach-prompt-dialog-target-kind"),
    ).toBeNull();
    expect(
      screen.queryByTestId("attach-prompt-dialog-target"),
    ).toBeNull();
    // The read-only summary takes their place.
    expect(
      screen.getByTestId("attach-prompt-dialog-locked-target"),
    ).toBeInTheDocument();

    // Wait for the prompts list to land then pick one.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
    await selectComboboxItem(user, "Prompt", "Системный промпт");

    await waitFor(() => {
      expect(
        screen.getByTestId("attach-prompt-dialog-save"),
      ).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("attach-prompt-dialog-save"));

    // Locked target dispatches the role-specific mutation against the
    // pre-supplied id.
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onAttached).toHaveBeenCalled();

    const addCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "add_role_prompt",
    );
    expect(addCall).toBeDefined();
    expect(addCall?.[1]).toMatchObject({
      roleId: ROLE.id,
      promptId: PROMPT.id,
    });
  });

  it("shows inline error when mutation fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "add_board_prompt") throw new Error("сбой базы данных");
      switch (cmd) {
        case "list_boards":
          return [BOARD];
        case "list_prompts":
          return [PROMPT];
        case "list_roles":
          return [ROLE];
        case "list_columns":
          return [COLUMN];
        case "list_tasks":
          return [];
        default:
          return undefined;
      }
    });

    const { user } = renderWithClient(
      <AttachPromptDialog isOpen onClose={() => undefined} />,
    );

    // wait for lists to resolve (invoke is async; react-query will have called list_boards by now)
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });

    await selectComboboxItem(user, "Board", "Доска Альфа");
    await selectComboboxItem(user, "Prompt", "Системный промпт");

    await waitFor(() => {
      expect(
        screen.getByTestId("attach-prompt-dialog-save"),
      ).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("attach-prompt-dialog-save"));

    await waitFor(() => {
      expect(
        screen.getByTestId("attach-prompt-dialog-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
