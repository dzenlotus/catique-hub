/**
 * useNewTaskKeybind — unit tests.
 *
 * Mirrors the `useGlobalSearchKeybind` test suite structure in
 * `widgets/global-search/GlobalSearch.test.tsx`.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

import { useNewTaskKeybind } from "./useNewTaskKeybind";

// ---------------------------------------------------------------------------
// Minimal harness
// ---------------------------------------------------------------------------

function HookHarness({ onActivate }: { onActivate: () => void }): ReactElement {
  useNewTaskKeybind(onActivate);
  return <div data-testid="harness" />;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useNewTaskKeybind", () => {
  it("calls onActivate on Cmd+N (metaKey)", () => {
    const onActivate = vi.fn();
    render(<HookHarness onActivate={onActivate} />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true }),
    );
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("calls onActivate on Ctrl+N (ctrlKey)", () => {
    const onActivate = vi.fn();
    render(<HookHarness onActivate={onActivate} />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true }),
    );
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onActivate for plain 'n' without modifier", () => {
    const onActivate = vi.fn();
    render(<HookHarness onActivate={onActivate} />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", bubbles: true }),
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does NOT call onActivate when active element is an <input>", () => {
    const onActivate = vi.fn();
    render(
      <>
        <HookHarness onActivate={onActivate} />
        <input data-testid="some-input" />
      </>,
    );
    screen.getByTestId("some-input").focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true }),
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does NOT call onActivate when active element is a <textarea>", () => {
    const onActivate = vi.fn();
    render(
      <>
        <HookHarness onActivate={onActivate} />
        <textarea data-testid="some-textarea" />
      </>,
    );
    screen.getByTestId("some-textarea").focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true }),
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("cleans up the listener on unmount", () => {
    const onActivate = vi.fn();
    const { unmount } = render(<HookHarness onActivate={onActivate} />);
    unmount();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true }),
    );
    expect(onActivate).not.toHaveBeenCalled();
  });
});
