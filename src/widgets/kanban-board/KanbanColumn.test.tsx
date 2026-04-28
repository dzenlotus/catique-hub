import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import type { ReactElement } from "react";

import type { Column } from "@entities/column";
import type { Task } from "@entities/task";

import { KanbanColumn } from "./KanbanColumn";

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-1",
    boardId: "brd-1",
    name: "In progress",
    position: 1n,
    roleId: null,
    createdAt: 0n,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk-1",
    boardId: "brd-1",
    columnId: "col-1",
    slug: "tsk-abc",
    title: "Pick a font",
    description: null,
    position: 1,
    roleId: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

// `useSortable` / `useDroppable` need to be mounted inside a DndContext.
// Tests don't simulate drags — they render markup and verify props
// flow correctly.
function renderInDnd(ui: ReactElement) {
  return render(<DndContext>{ui}</DndContext>);
}

describe("KanbanColumn", () => {
  it("renders the header (name + count) and the tasks", () => {
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ name: "Doing" })}
        tasks={[
          makeTask({ id: "t1", title: "First" }),
          makeTask({ id: "t2", title: "Second" }),
        ]}
      />,
    );
    expect(screen.getByText("Doing")).toBeInTheDocument();
    expect(screen.getByTestId("column-header-count")).toHaveTextContent("2");
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders the empty-state copy when there are no tasks", () => {
    renderInDnd(<KanbanColumn column={makeColumn({ id: "col-empty" })} tasks={[]} />);
    expect(
      screen.getByTestId("kanban-column-empty-col-empty"),
    ).toBeInTheDocument();
  });

  it("opens the add-task form on click and submits via onAddTask", async () => {
    const onAddTask = vi.fn();
    const user = userEvent.setup();
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-add" })}
        tasks={[]}
        onAddTask={onAddTask}
      />,
    );
    await user.click(screen.getByTestId("kanban-column-add-task-col-add"));
    const input = await screen.findByLabelText(/task title/i);
    await user.type(input, "Wire up DnD");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onAddTask).toHaveBeenCalledTimes(1);
    expect(onAddTask).toHaveBeenCalledWith("col-add", "Wire up DnD");
  });

  it("does not call onAddTask when the title is blank/whitespace", async () => {
    const onAddTask = vi.fn();
    const user = userEvent.setup();
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-blank" })}
        tasks={[]}
        onAddTask={onAddTask}
      />,
    );
    await user.click(screen.getByTestId("kanban-column-add-task-col-blank"));
    const input = await screen.findByLabelText(/task title/i);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onAddTask).not.toHaveBeenCalled();
  });

  it("hides the add-task footer when rendered as drag overlay", () => {
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-overlay" })}
        tasks={[]}
        dragOverlay
      />,
    );
    expect(
      screen.queryByTestId("kanban-column-add-task-col-overlay"),
    ).toBeNull();
  });
});
