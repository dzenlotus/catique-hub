import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren, ReactElement } from "react";

import { ToastProvider, useToast } from "@app/providers/ToastProvider";
import { Toaster } from "./Toaster";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Renders <Toaster> inside a <ToastProvider>. Returns a handle to pushToast. */
function setup() {
  let pushHandle!: ReturnType<typeof useToast>["pushToast"];

  function Capture({ children }: PropsWithChildren): ReactElement {
    const { pushToast } = useToast();
    pushHandle = pushToast;
    return <>{children}</>;
  }

  render(
    <ToastProvider>
      <Capture>
        <Toaster />
      </Capture>
    </ToastProvider>,
  );

  return { push: (kind: Parameters<typeof pushHandle>[0], msg: string) => pushHandle(kind, msg) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Toaster", () => {
  it("renders the container even when empty", () => {
    setup();
    expect(screen.getByTestId("toaster")).toBeInTheDocument();
  });

  it("renders a success toast with role=status", () => {
    const { push } = setup();

    act(() => {
      push("success", "Промпт сохранён");
    });

    const toasts = screen.getAllByRole("status");
    expect(toasts.length).toBeGreaterThanOrEqual(1);
    expect(toasts[0]).toHaveTextContent("Промпт сохранён");
  });

  it("renders an error toast with role=alert", () => {
    const { push } = setup();

    act(() => {
      push("error", "Не удалось сохранить промпт");
    });

    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0]).toHaveTextContent("Не удалось сохранить промпт");
  });

  it("renders an info toast with role=status", () => {
    const { push } = setup();

    act(() => {
      push("info", "Пересчитано 3 промптов");
    });

    const toasts = screen.getAllByRole("status");
    expect(toasts.length).toBeGreaterThanOrEqual(1);
    expect(toasts[0]).toHaveTextContent("Пересчитано 3 промптов");
  });

  it("dismiss button removes the toast from the DOM", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();

    let pushHandle!: ReturnType<typeof useToast>["pushToast"];

    function Capture(): ReactElement {
      const { pushToast } = useToast();
      pushHandle = pushToast;
      return <Toaster />;
    }

    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );

    act(() => {
      pushHandle("success", "Удалить меня");
    });

    expect(screen.getByText("Удалить меня")).toBeInTheDocument();

    const dismissBtns = screen.getAllByRole("button", { name: /закрыть уведомление/i });
    await user.click(dismissBtns[0]);

    expect(screen.queryByText("Удалить меня")).not.toBeInTheDocument();
  });

  it("auto-dismisses toast after 4 seconds", () => {
    const { push } = setup();

    act(() => {
      push("success", "Авто-исчезновение");
    });

    expect(screen.getByText("Авто-исчезновение")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    expect(screen.queryByText("Авто-исчезновение")).not.toBeInTheDocument();
  });

  it("enforces max-5 stack cap — oldest is dropped when 6th is added", () => {
    const { push } = setup();

    act(() => {
      for (let i = 0; i < 6; i++) {
        push("info", `Toast ${i}`);
      }
    });

    // Only 5 status items (info toasts use role=status)
    const statusItems = screen.getAllByRole("status");
    expect(statusItems).toHaveLength(5);
    expect(screen.queryByText("Toast 0")).not.toBeInTheDocument();
    expect(screen.getByText("Toast 5")).toBeInTheDocument();
  });

  it("renders all three kinds simultaneously", () => {
    const { push } = setup();

    act(() => {
      push("success", "Успех");
      push("error", "Ошибка");
      push("info", "Инфо");
    });

    expect(screen.getByText("Успех")).toBeInTheDocument();
    expect(screen.getByText("Ошибка")).toBeInTheDocument();
    expect(screen.getByText("Инфо")).toBeInTheDocument();
  });
});
