/**
 * MainPaneHeader — unit tests.
 *
 * Provider chain: QueryClientProvider > ActiveSpaceProvider, wrapped in a
 * wouter Router with a memory location so we can control the initial URL.
 *
 * The Tauri IPC bridge is mocked at `@shared/api` so react-query hooks
 * resolve from in-process stubs without needing the Tauri runtime.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactElement } from "react";

import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import type { Board } from "@entities/board";
import type { Space } from "@entities/space";
import type { Task } from "@entities/task";

// ---------------------------------------------------------------------------
// Mock the IPC boundary
// ---------------------------------------------------------------------------

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { MainPaneHeader } from "./MainPaneHeader";

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STUB_SPACE: Space = {
  id: "spc-1",
  name: "Catique",
  prefix: "ctq",
  description: null,
  isDefault: true,
  position: 1,
  createdAt: 0n,
  updatedAt: 0n,
};

const STUB_BOARD: Board = {
  id: "brd-001",
  name: "Sprint 14",
  spaceId: "spc-1",
  roleId: null,
  position: 1,
  createdAt: 0n,
  updatedAt: 0n,
};

const STUB_TASK: Task = {
  id: "tsk-001",
  boardId: "brd-001",
  columnId: "col-001",
  slug: "TSK-1",
  title: "Написать тесты",
  description: null,
  position: 1,
  roleId: null,
  createdAt: 0n,
  updatedAt: 0n,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderAt(path: string, client = makeClient()): void {
  const { hook } = memoryLocation({ path, static: true });

  const ui: ReactElement = (
    <Router hook={hook}>
      <QueryClientProvider client={client}>
        <ActiveSpaceProvider>
          <MainPaneHeader />
        </ActiveSpaceProvider>
      </QueryClientProvider>
    </Router>
  );

  render(ui);
}

/** Pre-seed the react-query cache to avoid triggering real IPC calls. */
function seedCache(
  client: QueryClient,
  options: {
    board?: Board;
    task?: Task;
  },
): void {
  if (options.board) {
    client.setQueryData(["boards", options.board.id], options.board);
  }
  if (options.task) {
    client.setQueryData(["tasks", "detail", options.task.id], options.task);
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.removeItem("catique:activeSpaceId");
  // Default: spaces query returns one stub space so the badge renders.
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "list_spaces") return [STUB_SPACE];
    return [];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("catique:activeSpaceId");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MainPaneHeader", () => {
  it('renders "Boards" label with LayoutGrid icon at "/"', async () => {
    renderAt("/");

    // The header element itself
    expect(screen.getByTestId("main-pane-header")).toBeInTheDocument();

    // The label text appears as a segment
    expect(screen.getByText("Boards")).toBeInTheDocument();
  });

  it('renders "Prompts" label at "/prompts"', async () => {
    renderAt("/prompts");

    expect(screen.getByText("Prompts")).toBeInTheDocument();
    // "Boards" must not appear at this route
    expect(screen.queryByText("Boards")).not.toBeInTheDocument();
  });

  it('renders "Boards / Sprint 14" breadcrumb at "/boards/brd-001" with cached board', async () => {
    const client = makeClient();
    seedCache(client, { board: STUB_BOARD });

    renderAt("/boards/brd-001", client);

    // Both segments should be visible
    expect(screen.getByText("Boards")).toBeInTheDocument();
    expect(screen.getByText("Sprint 14")).toBeInTheDocument();

    // The separator character
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it('renders "Boards / Написать тесты" breadcrumb at "/tasks/tsk-001" with cached task', async () => {
    const client = makeClient();
    seedCache(client, { task: STUB_TASK });

    renderAt("/tasks/tsk-001", client);

    expect(screen.getByText("Boards")).toBeInTheDocument();
    expect(screen.getByText("Написать тесты")).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("renders the active-space prefix badge when spaces resolve", async () => {
    renderAt("/");

    await waitFor(() => {
      expect(screen.getByTestId("main-pane-header-space-badge")).toBeInTheDocument();
    });

    expect(screen.getByTestId("main-pane-header-space-badge")).toHaveTextContent("ctq");
  });
});
