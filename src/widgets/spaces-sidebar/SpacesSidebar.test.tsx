import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { ToastProvider } from "@app/providers/ToastProvider";
import { LocalStorageStore, stringCodec } from "@shared/storage";
import { SpacesSidebar } from "./SpacesSidebar";

const activeSpaceStore = new LocalStorageStore<string>({
  key: "catique:activeSpaceId",
  codec: stringCodec,
});

// ---------------------------------------------------------------------------
// Mock the Tauri invoke wrapper so we can control what useSpaces() /
// useBoards() return.
// ---------------------------------------------------------------------------
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";

const invokeMock = vi.mocked(invoke);

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderWithClient(
  ui: ReactElement,
  client = makeQueryClient(),
  initialPath = "/",
): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  const { hook } = memoryLocation({ path: initialPath, static: true });
  render(
    <Router hook={hook}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ActiveSpaceProvider>{ui}</ActiveSpaceProvider>
        </ToastProvider>
      </QueryClientProvider>
    </Router>,
  );
  return { user };
}

function setup(): { user: ReturnType<typeof userEvent.setup> } {
  return renderWithClient(<SpacesSidebar />);
}

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------

const STUB_SPACES = [
  {
    id: "spc-1",
    name: "Alpha",
    prefix: "alp",
    description: null,
    isDefault: true,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "spc-2",
    name: "Beta",
    prefix: "bet",
    description: "Beta space",
    isDefault: false,
    position: 2,
    createdAt: 0n,
    updatedAt: 0n,
  },
];

const STUB_BOARDS = [
  {
    id: "brd-1",
    name: "Engineering",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 100n,
  },
  {
    id: "brd-2",
    name: "Roadmap",
    spaceId: "spc-1",
    roleId: null,
    position: 2,
    createdAt: 0n,
    updatedAt: 200n,
  },
];

function clearExpandedFlags(): void {
  // SpaceRow persists expand state per space under
  // `catique:sidebar:expanded:<spaceId>`. Across tests we want a fresh
  // state so the default-expanded heuristic kicks in again.
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith("catique:sidebar:expanded:")) {
      localStorage.removeItem(key);
    }
  }
}

beforeEach(() => {
  invokeMock.mockReset();
  activeSpaceStore.remove();
  clearExpandedFlags();
});

afterEach(() => {
  vi.restoreAllMocks();
  activeSpaceStore.remove();
  clearExpandedFlags();
});

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

describe("SpacesSidebar — SPACES section label", () => {
  beforeEach(() => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
  });

  it("renders the SPACES section label", () => {
    setup();
    expect(screen.getByText(/^SPACES$/)).toBeInTheDocument();
  });

  it("does NOT render the workspace nav rows (lives in MainSidebar)", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^boards$/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SPACES tree
// ---------------------------------------------------------------------------

describe("SpacesSidebar — SPACES tree (inline collapsible)", () => {
  it("shows a skeleton while spaces are loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    setup();
    const skeleton = document.querySelector("[aria-hidden='true']");
    expect(skeleton).toBeInTheDocument();
  });

  it("renders the active space name after load", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
  });

  it("renders an error indicator when useSpaces fails", async () => {
    invokeMock.mockRejectedValue(new Error("network error"));
    setup();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/spaces unavailable/i)).toBeInTheDocument();
  });

  it("shows empty state when spaces list is empty", async () => {
    invokeMock.mockResolvedValue([]);
    setup();
    await waitFor(() => {
      expect(screen.getByText(/no spaces yet/i)).toBeInTheDocument();
    });
  });

  it("renders a global '+ Add space' button at the bottom", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    setup();
    await waitFor(() => {
      expect(screen.getByTestId("spaces-sidebar-add-space")).toBeInTheDocument();
    });
  });

  it("clicking '+ Add space' opens the space-create dialog", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const { user } = setup();
    await waitFor(() => {
      expect(screen.getByTestId("spaces-sidebar-add-space")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("spaces-sidebar-add-space"));

    await waitFor(() => {
      expect(screen.getByTestId("space-create-dialog")).toBeInTheDocument();
    });
  });

  it("restores activeSpaceId from localStorage on mount", async () => {
    activeSpaceStore.set("spc-2");
    invokeMock.mockResolvedValue(STUB_SPACES);
    setup();
    await waitFor(() => {
      expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    });
  });

  it("expand chevron button has aria-expanded attribute", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const chevrons = screen.getAllByRole("button", { name: /expand|collapse/i });
    expect(chevrons.length).toBeGreaterThan(0);
    const first = chevrons[0];
    expect(first).toHaveAttribute("aria-expanded");
  });

  it("clicking chevron toggles aria-expanded", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const { user } = setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    const chevrons = screen.getAllByRole("button", { name: /expand|collapse/i });
    const alphaChevron = chevrons[0];
    const initialExpanded = alphaChevron.getAttribute("aria-expanded");

    await user.click(alphaChevron);

    await waitFor(() => {
      const newExpanded = alphaChevron.getAttribute("aria-expanded");
      expect(newExpanded).not.toBe(initialExpanded);
    });
  });

  it("does NOT render a per-space kebab button (ctq-76 item 1)", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("spaces-sidebar-space-kebab-spc-1"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Boards inside SPACES tree
// ---------------------------------------------------------------------------

describe("SpacesSidebar — boards inside SPACES tree", () => {
  it("renders board names inside the expanded space tree", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve(STUB_BOARDS);
      return Promise.resolve([]);
    });
    setup();
    await waitFor(() => {
      expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Roadmap").length).toBeGreaterThan(0);
  });
});
