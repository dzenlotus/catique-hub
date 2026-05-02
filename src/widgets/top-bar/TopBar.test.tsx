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
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactElement } from "react";

import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";

// ---------------------------------------------------------------------------
// Mock IPC
// ---------------------------------------------------------------------------

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

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

vi.mock("./useNewTaskKeybind", () => ({
  useNewTaskKeybind: (onActivate: () => void) => {
    // Expose the activator on window so tests can trigger it
    (window as unknown as Record<string, unknown>)["__newTaskActivate__"] =
      onActivate;
  },
}));

// ---------------------------------------------------------------------------
// Mock TaskCreateDialog
// ---------------------------------------------------------------------------

vi.mock("@widgets/task-create-dialog", () => ({
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
import { TopBar } from "./TopBar";

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
  const { hook } = memoryLocation({ path, static: true });

  const ui: ReactElement = (
    <Router hook={hook}>
      <QueryClientProvider client={makeClient()}>
        <ActiveSpaceProvider>
          <TopBar />
        </ActiveSpaceProvider>
      </QueryClientProvider>
    </Router>
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
  invokeMock.mockResolvedValue([]);
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
  it("рендерит поле поиска с иконкой и подсказкой ⌘K", () => {
    renderAt();

    const trigger = screen.getByTestId("top-bar-search-trigger");
    expect(trigger).toBeInTheDocument();

    // Placeholder text (English per mockup)
    expect(screen.getByText("Search tasks, boards, agents...")).toBeInTheDocument();

    // ⌘K badge
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("размечает пустые области шапки как drag-region для Tauri 2.10", () => {
    renderAt();

    const topBar = screen.getByTestId("top-bar");
    expect(topBar).toHaveAttribute("data-tauri-drag-region", "true");
    expect(
      topBar.querySelectorAll('[data-tauri-drag-region="true"]'),
    ).toHaveLength(2);
    expect(screen.getByTestId("top-bar-search-trigger")).not.toHaveAttribute(
      "data-tauri-drag-region",
    );
  });

  it("клик по полю поиска открывает GlobalSearch (isOpen=true)", () => {
    renderAt();

    expect(capturedIsOpen).toBe(false);
    expect(screen.queryByTestId("global-search-mock")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("top-bar-search-trigger"));

    expect(capturedIsOpen).toBe(true);
    expect(screen.getByTestId("global-search-mock")).toBeInTheDocument();
  });

  it("хук ⌘K при вызове открывает GlobalSearch", () => {
    renderAt();

    expect(capturedIsOpen).toBe(false);

    // Trigger the keybind activator exposed by our mock hook
    const activate = (window as unknown as Record<string, unknown>)[
      "__searchActivate__"
    ] as (() => void) | undefined;
    expect(activate).toBeDefined();

    act(() => {
      activate!();
    });

    expect(capturedIsOpen).toBe(true);
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
