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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TopBar", () => {
  it("рендерит поле поиска с иконкой и подсказкой ⌘K", () => {
    renderAt();

    const trigger = screen.getByTestId("top-bar-search-trigger");
    expect(trigger).toBeInTheDocument();

    // Placeholder text
    expect(screen.getByText("Поиск...")).toBeInTheDocument();

    // ⌘K badge
    expect(screen.getByText("⌘K")).toBeInTheDocument();
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

  it('рендерит кнопку «+ Новая задача» с иконкой Plus и лейблом', () => {
    renderAt();

    const btn = screen.getByTestId("top-bar-new-task");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Новая задача");
    // SVG Lucide Plus icon should be present (aria-hidden)
    expect(btn.querySelector("svg")).toBeInTheDocument();
  });

  it('кнопка настроек имеет aria-label="Настройки"', () => {
    renderAt();

    const btn = screen.getByTestId("top-bar-settings");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Настройки");
  });

  it('кнопка уведомлений имеет aria-label="Уведомления"', () => {
    renderAt();

    const btn = screen.getByTestId("top-bar-bell");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Уведомления");
  });

  it("аватар рендерится с инициалом M и aria-label", () => {
    renderAt();

    const avatar = screen.getByTestId("top-bar-avatar");
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveTextContent("M");
    expect(avatar).toHaveAttribute("aria-label", "Профиль пользователя");
  });

  it("хлебная крошка не отображается на маршруте /", () => {
    renderAt("/");
    expect(screen.queryByLabelText("Навигационная цепочка")).not.toBeInTheDocument();
  });
});
