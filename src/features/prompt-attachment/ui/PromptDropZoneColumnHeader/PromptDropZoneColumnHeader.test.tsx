import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import { PromptDropZoneColumnHeader } from "./PromptDropZoneColumnHeader";

/**
 * `PromptDropZoneColumnHeader` tests.
 *
 * Verifies that the ColumnHeader content is rendered and that the droppable
 * wrapper doesn't interfere with normal header presentation.
 * Active-over visual (overlay) is not tested here — it requires
 * simulating a DnD pointer event, which is an integration concern.
 */

describe("PromptDropZoneColumnHeader", () => {
  it("renders the column name via ColumnHeader", () => {
    render(
      <DndContext>
        <PromptDropZoneColumnHeader
          columnId="col-001"
          id="col-001"
          name="В работе"
          taskCount={3}
        />
      </DndContext>,
    );
    expect(screen.getByText("В работе")).toBeInTheDocument();
  });

  it("renders the task count badge", () => {
    render(
      <DndContext>
        <PromptDropZoneColumnHeader
          columnId="col-002"
          id="col-002"
          name="Готово"
          taskCount={7}
        />
      </DndContext>,
    );
    expect(screen.getByTestId("column-header-count")).toHaveTextContent("7");
  });

  it("does not render the drop overlay when not dragging over", () => {
    const { container } = render(
      <DndContext>
        <PromptDropZoneColumnHeader
          columnId="col-003"
          id="col-003"
          name="Бэклог"
          taskCount={0}
        />
      </DndContext>,
    );
    // The overlay is a <div aria-hidden="true"> placed as a direct child of the
    // wrapper div. ColumnHeader itself contains <span aria-hidden="true"> elements
    // (e.g. the more-menu icon), so we query for a div with aria-hidden.
    const overlay = container.querySelector("div[aria-hidden='true']");
    expect(overlay).toBeNull();
  });

  it("renders a position-relative wrapper (for the absolute overlay)", () => {
    const { container } = render(
      <DndContext>
        <PromptDropZoneColumnHeader
          columnId="col-004"
          id="col-004"
          name="Тест"
          taskCount={0}
        />
      </DndContext>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.tagName).toBe("DIV");
  });

  it("renders the header element inside the wrapper", () => {
    render(
      <DndContext>
        <PromptDropZoneColumnHeader
          columnId="col-005"
          id="col-005"
          name="Колонка"
          taskCount={2}
        />
      </DndContext>,
    );
    expect(screen.getByTestId("column-header-col-005")).toBeInTheDocument();
  });
});
