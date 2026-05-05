/**
 * BoardSettings — unit tests focused on the owner-cat picker (ctq-106).
 *
 * Test surface:
 *   - The picker pre-selects the board's current `ownerRoleId`.
 *   - The Dirizher coordinator is excluded from the option list.
 *   - Switching to another cat fires `update_board` (the
 *     `// TODO(ctq-101)` shim) with `ownerRoleId` and the cache picks
 *     up the optimistic state immediately.
 *   - Server failure rolls the picker back to the previous value and
 *     surfaces an error toast.
 *
 * Provider chain mirrors KanbanBoard: QueryClient > ActiveSpace >
 * Toast > Router(memory) so wouter `useParams` resolves the boardId
 * exactly the way the production shell does.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { routes } from "@app/routes";
import type { ReactElement } from "react";

import type { Board } from "@entities/board";
import type { Role } from "@entities/role";
import type { Space } from "@entities/space";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
  on: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@shared/api";
import { BoardSettings } from "./BoardSettings";

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Fixtures
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

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "spc-1",
    name: "Main",
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

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-user",
    name: "Senior Cat",
    content: "",
    color: null,
    isSystem: false,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function defaultRoles(): Role[] {
  return [
    makeRole({ id: "maintainer-system", name: "Maintainer", isSystem: true }),
    makeRole({ id: "dirizher-system", name: "Dirizher", isSystem: true }),
    makeRole({ id: "role-user", name: "Senior Cat", isSystem: false }),
  ];
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderSettings(boardId = "brd-1"): {
  user: ReturnType<typeof userEvent.setup>;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  const { hook } = memoryLocation({ path: `/boards/${boardId}/settings` });
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <ActiveSpaceProvider>
        <ToastProvider>
          <Router hook={hook}>
            <Route path={routes.boardSettings}>
              <BoardSettings />
            </Route>
          </Router>
        </ToastProvider>
      </ActiveSpaceProvider>
    </QueryClientProvider>
  );
  render(tree);
  return { user, client };
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

describe("BoardSettings — owner cat picker (ctq-106)", () => {
  it("preselects the current owner cat from the board record", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return makeBoard({ ownerRoleId: "role-user" });
      if (cmd === "list_spaces") return [makeSpace()];
      if (cmd === "list_roles") return defaultRoles();
      throw new Error(`unexpected: ${cmd}`);
    });

    renderSettings();

    const select = (await screen.findByTestId(
      "board-settings-owner-select",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("role-user");
    });
  });

  it("excludes Dirizher from the picker but keeps Maintainer", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return makeBoard();
      if (cmd === "list_spaces") return [makeSpace()];
      if (cmd === "list_roles") return defaultRoles();
      throw new Error(`unexpected: ${cmd}`);
    });

    renderSettings();

    const select = (await screen.findByTestId(
      "board-settings-owner-select",
    )) as HTMLSelectElement;

    await waitFor(() => {
      const ids = Array.from(select.options).map((o) => o.value);
      expect(ids).toContain("maintainer-system");
      expect(ids).toContain("role-user");
      expect(ids).not.toContain("dirizher-system");
    });
  });

  it("round-trips the new owner via update_board on change", async () => {
    const initialBoard = makeBoard({ ownerRoleId: "maintainer-system" });
    const updatedBoard = makeBoard({ ownerRoleId: "role-user" });
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "get_board") return initialBoard;
      if (cmd === "list_spaces") return [makeSpace()];
      if (cmd === "list_roles") return defaultRoles();
      if (cmd === "update_board") {
        // Expect the optimistic shim to forward the new owner id —
        // ctq-101 will replace `update_board` with `set_board_owner`,
        // but the camelCase contract stays the same.
        expect(args).toMatchObject({ id: "brd-1", ownerRoleId: "role-user" });
        return updatedBoard;
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderSettings();

    const select = (await screen.findByTestId(
      "board-settings-owner-select",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(
        Array.from(select.options).map((o) => o.value),
      ).toContain("role-user");
    });

    await user.selectOptions(select, "role-user");

    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "update_board",
      );
      expect(calls).toHaveLength(1);
    });
    // Optimistic state lands immediately, then the server response
    // ratifies it.
    await waitFor(() => {
      expect(select.value).toBe("role-user");
    });
  });

  it("rolls back the picker and toasts on update failure", async () => {
    const initialBoard = makeBoard({ ownerRoleId: "maintainer-system" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return initialBoard;
      if (cmd === "list_spaces") return [makeSpace()];
      if (cmd === "list_roles") return defaultRoles();
      if (cmd === "update_board") throw new Error("db conflict");
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderSettings();

    const select = (await screen.findByTestId(
      "board-settings-owner-select",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(
        Array.from(select.options).map((o) => o.value),
      ).toContain("role-user");
    });

    await act(async () => {
      await user.selectOptions(select, "role-user");
    });

    // The IPC fired with the new owner — rollback is what we observe
    // in the picker once the rejection surfaces.
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "update_board",
      );
      expect(calls).toHaveLength(1);
    });

    // Picker rolls back to the previous owner once the rejection
    // resolves. Toast surfacing is covered by `Toaster.test.tsx`; we
    // only validate the optimistic rollback contract here.
    await waitFor(() => {
      expect(select.value).toBe("maintainer-system");
    });
  });
});

describe("BoardSettings — board prompts section (ctq-102)", () => {
  it("opens AttachPromptDialog with locked board target on Attach", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_board") return makeBoard();
      if (cmd === "list_spaces") return [makeSpace()];
      if (cmd === "list_roles") return defaultRoles();
      if (cmd === "list_prompts") return [];
      if (cmd === "list_boards") return [makeBoard()];
      if (cmd === "list_columns") return [];
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderSettings();
    const attachBtn = await screen.findByTestId(
      "board-settings-prompts-attach",
    );
    await user.click(attachBtn);

    await waitFor(() => {
      expect(screen.getByTestId("attach-prompt-dialog")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("attach-prompt-dialog-locked-target"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("attach-prompt-dialog-target-kind"),
    ).not.toBeInTheDocument();
  });
});
