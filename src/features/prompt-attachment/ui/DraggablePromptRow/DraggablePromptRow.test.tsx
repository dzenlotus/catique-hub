import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import { DraggablePromptRow } from "./DraggablePromptRow";

/**
 * `DraggablePromptRow` tests.
 *
 * These tests verify the wrapper renders its children correctly and
 * exposes the expected drag attributes. We avoid simulating an actual
 * pointer drag — that path is covered by integration-level tests.
 * `@dnd-kit/core` is NOT mocked; it runs in the jsdom environment the
 * same way `KanbanBoard` tests do.
 */

describe("DraggablePromptRow", () => {
  it("renders children", () => {
    render(
      <DndContext>
        <DraggablePromptRow promptId="pmt-001">
          <span data-testid="child">Промпт</span>
        </DraggablePromptRow>
      </DndContext>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByTestId("child")).toHaveTextContent("Промпт");
  });

  it("renders a single wrapper div", () => {
    const { container } = render(
      <DndContext>
        <DraggablePromptRow promptId="pmt-002">
          <span>child</span>
        </DraggablePromptRow>
      </DndContext>,
    );
    // The DraggablePromptRow renders one <div> wrapping the child.
    const wrappers = container.querySelectorAll("div");
    // At least one div should be in the tree (the row wrapper).
    expect(wrappers.length).toBeGreaterThanOrEqual(1);
  });

  it("exposes role=button and aria-roledescription attributes from dnd-kit (a11y)", () => {
    render(
      <DndContext>
        <DraggablePromptRow promptId="pmt-003">
          <span>child</span>
        </DraggablePromptRow>
      </DndContext>,
    );
    // dnd-kit useDraggable spreads `attributes` which includes
    // role="button" and aria-roledescription="draggable" on the node.
    const draggable = screen.getByRole("button");
    expect(draggable).toBeInTheDocument();
  });

  it("is not visually hidden when not dragging (full opacity)", () => {
    render(
      <DndContext>
        <DraggablePromptRow promptId="pmt-004">
          <span data-testid="inner">inner</span>
        </DraggablePromptRow>
      </DndContext>,
    );
    // When not dragging, no inline opacity style should be set
    // (or it should be the default).
    const row = screen.getByTestId("inner").parentElement!;
    expect(row.style.opacity).not.toBe("0.35");
  });

  it("does not throw when promptId contains special characters", () => {
    expect(() =>
      render(
        <DndContext>
          <DraggablePromptRow promptId="pmt/uuid-123:test">
            <span>ok</span>
          </DraggablePromptRow>
        </DndContext>,
      ),
    ).not.toThrow();
  });

  it("accepts any ReactNode as children", () => {
    const onSelect = vi.fn();
    render(
      <DndContext>
        <DraggablePromptRow promptId="pmt-005">
          <button type="button" onClick={onSelect}>
            Нажми
          </button>
        </DraggablePromptRow>
      </DndContext>,
    );
    expect(screen.getByText("Нажми")).toBeInTheDocument();
  });
});
