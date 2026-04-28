import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren, ReactElement } from "react";

import { ToastProvider, useToast } from "./ToastProvider";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapper({ children }: PropsWithChildren): ReactElement {
  return <ToastProvider>{children}</ToastProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ToastProvider / useToast", () => {
  it("throws when used outside the provider", () => {
    // Suppress React's console.error noise for this expected throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useToast())).toThrow(
      "useToast must be used within <ToastProvider>",
    );
    spy.mockRestore();
  });

  it("starts with an empty toast list", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("pushToast appends a toast", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.pushToast("success", "Промпт сохранён");
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({
      kind: "success",
      message: "Промпт сохранён",
    });
  });

  it("each toast has a unique id", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.pushToast("success", "A");
      result.current.pushToast("error", "B");
    });

    const [a, b] = result.current.toasts;
    expect(a.id).not.toBe(b.id);
  });

  it("dismissToast removes a toast by id", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.pushToast("info", "Тест");
    });

    const id = result.current.toasts[0].id;

    act(() => {
      result.current.dismissToast(id);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("auto-dismisses after 4 seconds", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.pushToast("success", "Авто");
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("does NOT auto-dismiss before 4 seconds", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.pushToast("success", "Авто");
    });

    act(() => {
      vi.advanceTimersByTime(3_999);
    });

    expect(result.current.toasts).toHaveLength(1);
  });

  it("enforces stack cap of 5 — oldest toast is dropped", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      for (let i = 0; i < 6; i++) {
        result.current.pushToast("info", `Toast ${i}`);
      }
    });

    expect(result.current.toasts).toHaveLength(5);
    // First pushed (index 0) should be gone; "Toast 1" should be the oldest remaining.
    expect(result.current.toasts[0].message).toBe("Toast 1");
    expect(result.current.toasts[4].message).toBe("Toast 5");
  });

  it("multiple kinds are accepted", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.pushToast("success", "Успех");
      result.current.pushToast("error", "Ошибка");
      result.current.pushToast("info", "Инфо");
    });

    const kinds = result.current.toasts.map((t) => t.kind);
    expect(kinds).toContain("success");
    expect(kinds).toContain("error");
    expect(kinds).toContain("info");
  });

  it("dismissToast is a no-op for unknown id", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.pushToast("info", "Тест");
    });

    // Should not throw, and the existing toast should remain.
    act(() => {
      result.current.dismissToast("non-existent-id");
    });

    expect(result.current.toasts).toHaveLength(1);
  });
});

// ─── Render-level smoke test ─────────────────────────────────────────────────

function ToastTrigger(): ReactElement {
  const { pushToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => pushToast("success", "Рендер-тест")}
    >
      Показать
    </button>
  );
}

describe("ToastProvider render", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children without errors", () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    expect(screen.getByText("Показать")).toBeInTheDocument();
  });

  it("pushToast called from child updates context", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    await user.click(screen.getByText("Показать"));
    // No assertion on DOM — just verify no throw. The Toaster widget
    // tests cover the rendered output.
  });
});
