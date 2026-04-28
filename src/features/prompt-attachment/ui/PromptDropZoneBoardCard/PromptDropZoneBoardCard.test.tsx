import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import type { Board } from "@entities/board";
import { PromptDropZoneBoardCard } from "./PromptDropZoneBoardCard";

/**
 * `PromptDropZoneBoardCard` tests.
 *
 * Verifies that the BoardCard content is rendered and that the droppable
 * wrapper doesn't interfere with normal card presentation.
 * Active-over visual (overlay) is not tested here — it requires
 * simulating a DnD pointer event, which is an integration concern.
 */

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-001",
    name: "Sprint 14",
    spaceId: "spc-default",
    roleId: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("PromptDropZoneBoardCard", () => {
  it("renders the board name via BoardCard", () => {
    render(
      <DndContext>
        <PromptDropZoneBoardCard
          boardId="brd-001"
          board={makeBoard({ name: "Мой проект" })}
        />
      </DndContext>,
    );
    expect(screen.getByText("Мой проект")).toBeInTheDocument();
  });

  it("renders the BoardCard as a native button (a11y)", () => {
    render(
      <DndContext>
        <PromptDropZoneBoardCard boardId="brd-002" board={makeBoard()} />
      </DndContext>,
    );
    // The inner BoardCard is a <button>
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("does not render the overlay when not dragging over", () => {
    const { container } = render(
      <DndContext>
        <PromptDropZoneBoardCard boardId="brd-003" board={makeBoard()} />
      </DndContext>,
    );
    // No overlay div should exist when isOver is false
    const overlay = container.querySelector("[aria-hidden='true']");
    expect(overlay).toBeNull();
  });

  it("renders skeleton when board prop is omitted", () => {
    render(
      <DndContext>
        <PromptDropZoneBoardCard boardId="brd-004" />
      </DndContext>,
    );
    expect(screen.getByTestId("board-card-skeleton")).toBeInTheDocument();
  });

  it("calls onSelect with the board id when clicked", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <DndContext>
        <PromptDropZoneBoardCard
          boardId="brd-005"
          board={makeBoard({ id: "brd-005", name: "Clickable" })}
          onSelect={onSelect}
        />
      </DndContext>,
    );
    await user.click(screen.getByText("Clickable"));
    expect(onSelect).toHaveBeenCalledWith("brd-005");
  });

  it("renders a position-relative wrapper (for the absolute overlay)", () => {
    const { container } = render(
      <DndContext>
        <PromptDropZoneBoardCard boardId="brd-006" board={makeBoard()} />
      </DndContext>,
    );
    // The outermost div has the CSS module class; we just check it's a div
    const wrapper = container.firstElementChild;
    expect(wrapper?.tagName).toBe("DIV");
  });
});
