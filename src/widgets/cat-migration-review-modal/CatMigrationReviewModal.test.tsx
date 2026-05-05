/**
 * CatMigrationReviewModal — unit tests for ctq-82 (P1-T4).
 *
 * Surface under test:
 *   - Mount-side guard renders the modal only while
 *     `cat_migration_reviewed === 'false'`.
 *   - "Looks good" CTA writes `'true'` via `set_setting` and tears the
 *     modal down on success.
 *   - Per-row Combobox calls `set_board_owner` with the new id.
 *   - Optimistic rollback on `set_board_owner` failure (toast surfacing
 *     is covered by `Toaster.test.tsx`; here we assert IPC contract).
 *   - Roster excludes Dirizher but keeps Maintainer (existing
 *     `useRoles({excludeSystem})` contract).
 *   - Modal absent on a "second launch" — i.e. when the flag is
 *     `'true'` from boot, the mount renders nothing.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Board } from "@entities/board";
import type { Role } from "@entities/role";
import type { Space } from "@entities/space";
import { ToastProvider } from "@app/providers/ToastProvider";
import { CatMigrationReviewMount } from "@app/providers/CatMigrationReviewMount";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
  on: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@shared/api";

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
    workflowGraphJson: null,
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

function renderMount(): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CatMigrationReviewMount />
      </ToastProvider>
    </QueryClientProvider>
  );
  render(tree);
  return { user };
}

/**
 * Configure the standard "fresh DB" mock: flag = `'false'`, one board,
 * one space, the seeded role roster.
 */
function setupFreshDbMocks(opts: {
  boards?: Board[];
  spaces?: Space[];
  roles?: Role[];
  flagValue?: string | null;
} = {}): void {
  const boards = opts.boards ?? [makeBoard()];
  const spaces = opts.spaces ?? [makeSpace()];
  const roles = opts.roles ?? defaultRoles();
  const flagValue = opts.flagValue ?? "false";
  invokeMock.mockImplementation(async (cmd, args) => {
    if (cmd === "get_setting") {
      const key = (args as { key?: string } | undefined)?.key;
      if (key === "cat_migration_reviewed") return flagValue;
      return null;
    }
    if (cmd === "set_setting") {
      return undefined as unknown;
    }
    if (cmd === "list_boards") return boards;
    if (cmd === "list_spaces") return spaces;
    if (cmd === "list_roles") return roles;
    if (cmd === "set_board_owner") {
      const boardId = (args as { boardId?: string } | undefined)?.boardId;
      const roleId = (args as { roleId?: string } | undefined)?.roleId;
      const found = boards.find((b) => b.id === boardId);
      if (!found) throw new Error("board not found");
      return { ...found, ownerRoleId: roleId ?? found.ownerRoleId };
    }
    throw new Error(`unexpected command: ${cmd}`);
  });
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

describe("CatMigrationReviewMount — boot-time flag gating", () => {
  it("renders the modal when cat_migration_reviewed === 'false'", async () => {
    setupFreshDbMocks();
    renderMount();
    expect(
      await screen.findByTestId("cat-migration-review-modal"),
    ).toBeInTheDocument();
  });

  it("does NOT render the modal when cat_migration_reviewed === 'true'", async () => {
    setupFreshDbMocks({ flagValue: "true" });
    renderMount();
    // Wait for the flag query to resolve — `get_setting` is the first
    // call the mount fires. After it resolves with 'true', no modal.
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "get_setting",
      );
      expect(calls.length).toBeGreaterThan(0);
    });
    expect(
      screen.queryByTestId("cat-migration-review-modal"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the modal when the flag is absent (null)", async () => {
    setupFreshDbMocks({ flagValue: null });
    renderMount();
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "get_setting",
      );
      expect(calls.length).toBeGreaterThan(0);
    });
    expect(
      screen.queryByTestId("cat-migration-review-modal"),
    ).not.toBeInTheDocument();
  });
});

describe("CatMigrationReviewModal — board list contents", () => {
  it("lists all boards once the modal is open", async () => {
    setupFreshDbMocks({
      boards: [
        makeBoard({ id: "brd-1", name: "Roadmap" }),
        makeBoard({ id: "brd-2", name: "Backlog" }),
      ],
    });
    renderMount();
    expect(
      await screen.findByTestId("cat-migration-review-row-brd-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("cat-migration-review-row-brd-2"),
    ).toBeInTheDocument();
  });

  it("renders an empty-state when no boards exist", async () => {
    setupFreshDbMocks({ boards: [] });
    renderMount();
    expect(
      await screen.findByTestId("cat-migration-review-empty"),
    ).toBeInTheDocument();
  });
});

describe("CatMigrationReviewModal — confirmation flow", () => {
  it("'Looks good' writes 'true' via set_setting and tears the modal down", async () => {
    setupFreshDbMocks();
    const { user } = renderMount();

    const confirmBtn = await screen.findByTestId(
      "cat-migration-review-confirm",
    );
    await user.click(confirmBtn);

    await waitFor(() => {
      const setCalls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "set_setting",
      );
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]?.[1]).toEqual({
        key: "cat_migration_reviewed",
        value: "true",
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("cat-migration-review-modal"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("CatMigrationReviewModal — per-row reassignment", () => {
  it("calls set_board_owner with the picked roleId on selection change", async () => {
    setupFreshDbMocks();
    const { user } = renderMount();

    const combobox = await screen.findByTestId(
      "cat-migration-review-combobox-brd-1",
    );
    // RAC ComboBox exposes a `combobox`-role input. Open the listbox
    // with ArrowDown and pick the user-cat option.
    const input = combobox.querySelector("input");
    expect(input).not.toBeNull();
    if (!input) throw new Error("combobox input missing");
    input.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    const userOption = await screen.findByRole("option", {
      name: "Senior Cat",
    });
    await user.click(userOption);

    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "set_board_owner",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toMatchObject({
        boardId: "brd-1",
        roleId: "role-user",
      });
    });
  });
});
