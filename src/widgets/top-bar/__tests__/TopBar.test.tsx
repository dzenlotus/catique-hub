/**
 * TopBar — unit tests.
 *
 * Provider chain: QueryClientProvider > ActiveSpaceProvider, wrapped in a
 * wouter Router with a memory location.
 *
 * GlobalSearch и useGlobalSearchKeybind мокируются, чтобы тесты не
 * зависели от RAC Modal и Tauri IPC.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestRouter } from "@shared/lib";
import type { ReactElement } from "react";

import { ActiveSpaceProvider } from "@app/providers";

// ---------------------------------------------------------------------------
// Mock IPC
// ---------------------------------------------------------------------------

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

// ---------------------------------------------------------------------------
// Mock GlobalSearch + useGlobalSearchKeybind
// ---------------------------------------------------------------------------

// Capture the last props passed to GlobalSearch so tests can assert on them.
let capturedIsOpen = false;
const mockOnClose = vi.fn();

vi.mock("@widgets/global-search", () => ({
  GlobalSearch: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) => {
    capturedIsOpen = isOpen;
    mockOnClose.mockImplementation(onClose);
    return isOpen ? (
      <div data-testid="global-search-mock" />
    ) : null;
  },
  useGlobalSearchKeybind: (onActivate: () => void) => {
    // Expose the activator on window so tests can trigger it
    (window as unknown as Record<string, unknown>)["__searchActivate__"] =
      onActivate;
  },
}));

// ---------------------------------------------------------------------------
// Mock useNewTaskKeybind (defined in the same widget directory)
// ---------------------------------------------------------------------------

vi.mock("../useNewTaskKeybind", () => ({
  useNewTaskKeybind: (onActivate: () => void) => {
    // Expose the activator on window so tests can trigger it
    (window as unknown as Record<string, unknown>)["__newTaskActivate__"] =
      onActivate;
  },
}));

// ---------------------------------------------------------------------------
// Mock TaskCreateDialog
// ---------------------------------------------------------------------------

vi.mock("@features/task/create-dialog", () => ({
  TaskCreateDialog: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) => {
    void onClose;
    return isOpen ? (
      <div data-testid="task-create-dialog-mock" />
    ) : null;
  },
}));

import { invoke } from "@shared/api";
import { TopBar } from "../TopBar";

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderAt(path = "/"): { rerender: () => void } {
  const ui: ReactElement = (
    <TestRouter path={path}>
      <QueryClientProvider client={makeClient()}>
        <ActiveSpaceProvider>
          <TopBar />
        </ActiveSpaceProvider>
      </QueryClientProvider>
    </TestRouter>
  );

  const result = render(ui);
  return {
    rerender: () => result.rerender(ui),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  invokeMock.mockReset();
  capturedIsOpen = false;
  mockOnClose.mockReset();
  // Round-21: SyncIndicator subscribes to `get_sync_status`. Stub a
  // benign idle response so the indicator stays hidden in TopBar tests.
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_sync_status") return Promise.resolve({ state: "idle" });
    return Promise.resolve([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>)["__searchActivate__"];
  delete (window as unknown as Record<string, unknown>)["__newTaskActivate__"];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TopBar", () => {
  it("renders the global search trigger pill", () => {
    renderAt();

    expect(screen.getByTestId("top-bar-search-trigger")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("opens the global search palette when the trigger is clicked", () => {
    renderAt();

    expect(screen.queryByTestId("global-search-mock")).not.toBeInTheDocument();

    act(() => {
      screen.getByTestId("top-bar-search-trigger").click();
    });

    expect(capturedIsOpen).toBe(true);
    expect(screen.getByTestId("global-search-mock")).toBeInTheDocument();
  });

  it("wires the ⌘K keybind to open the palette", () => {
    renderAt();
    const activate = (window as unknown as Record<string, unknown>)[
      "__searchActivate__"
    ] as (() => void) | undefined;
    expect(activate).toBeDefined();

    act(() => {
      activate!();
    });

    expect(screen.getByTestId("global-search-mock")).toBeInTheDocument();
  });

  it("does NOT render the prompts tag-filter (moved to the prompts sidebar)", () => {
    renderAt("/prompts");
    expect(
      screen.queryByTestId("top-bar-prompts-tag-filter"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("prompts-tag-filter"),
    ).not.toBeInTheDocument();
  });

  it("размечает пустые области шапки как drag-region для Tauri 2.10", () => {
    renderAt();

    const topBar = screen.getByTestId("top-bar");
    expect(topBar).toHaveAttribute("data-tauri-drag-region", "true");
    expect(
      topBar.querySelectorAll('[data-tauri-drag-region="true"]'),
    ).toHaveLength(3);
  });

  it("does NOT render a «+ New task» CTA in the top-bar (round-19c removal)", () => {
    // The CTA was removed by user request — task creation reaches via
    // Cmd+N global keybind and through column / board affordances.
    renderAt();
    expect(screen.queryByTestId("top-bar-new-task")).not.toBeInTheDocument();
  });

  it("хлебная крошка не отображается на маршруте /", () => {
    renderAt("/");
    expect(screen.queryByLabelText("Навигационная цепочка")).not.toBeInTheDocument();
  });

  it("хук ⌘N при вызове открывает TaskCreateDialog", () => {
    renderAt();

    expect(screen.queryByTestId("task-create-dialog-mock")).not.toBeInTheDocument();

    const activate = (window as unknown as Record<string, unknown>)[
      "__newTaskActivate__"
    ] as (() => void) | undefined;
    expect(activate).toBeDefined();

    act(() => {
      activate!();
    });

    expect(screen.getByTestId("task-create-dialog-mock")).toBeInTheDocument();
  });
});
