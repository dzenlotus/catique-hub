import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DragDropProvider } from "@dnd-kit/react";
import type { Column } from "@entities/column";
import type { Task } from "@entities/task";

import { KanbanColumn } from "./KanbanColumn";

/**
 * `KanbanColumn` is a presentational component receiving column/tasks
 * via props. The only external dependency is `@dnd-kit/react`'s
 * `useSortable` hook — wrap the rendered tree in `DragDropProvider`
 * so the hook has a context to register against.
 *
 * F-02 of docs/audit/kanban-frontend-audit.md (ctq-75).
 */

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-1",
    boardId: "brd-1",
    name: "Backlog",
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
    slug: "tsk-1",
    title: "Test task",
    description: null,
    position: 1,
    roleId: null,
    stepLog: "",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

interface RenderOptions {
  column?: Column;
  tasks?: Task[];
  onTaskSelect?: (id: string) => void;
  onAddTask?: (id: string) => void;
  onRenameColumn?: (id: string, name: string) => void;
  onDeleteColumn?: (id: string) => void;
}

function renderColumn(options: RenderOptions = {}): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const user = userEvent.setup();
  render(
    <DragDropProvider>
      <KanbanColumn
        column={options.column ?? makeColumn()}
        index={0}
        tasks={options.tasks ?? []}
        onTaskSelect={options.onTaskSelect ?? vi.fn()}
        onAddTask={options.onAddTask ?? vi.fn()}
        onRenameColumn={options.onRenameColumn ?? vi.fn()}
        onDeleteColumn={options.onDeleteColumn ?? vi.fn()}
      />
    </DragDropProvider>,
  );
  return { user };
}

describe("KanbanColumn", () => {
  it("renders column name in the header", () => {
    renderColumn({ column: makeColumn({ name: "In progress" }) });
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("renders one card per task", () => {
    const tasks = [
      makeTask({ id: "t1", title: "First" }),
      makeTask({ id: "t2", title: "Second" }),
      makeTask({ id: "t3", title: "Third" }),
    ];
    renderColumn({ tasks });
    expect(screen.getByTestId("task-card-t1")).toBeInTheDocument();
    expect(screen.getByTestId("task-card-t2")).toBeInTheDocument();
    expect(screen.getByTestId("task-card-t3")).toBeInTheDocument();
  });

  it("renders the empty-state button when there are no tasks", () => {
    renderColumn({ tasks: [] });
    expect(
      screen.getByTestId(`kanban-column-empty-${makeColumn().id}`),
    ).toBeInTheDocument();
  });

  it("invokes onAddTask when the empty-state button is clicked", async () => {
    const onAddTask = vi.fn();
    const { user } = renderColumn({ tasks: [], onAddTask });
    await user.click(
      screen.getByTestId(`kanban-column-empty-${makeColumn().id}`),
    );
    expect(onAddTask).toHaveBeenCalledWith(makeColumn().id);
  });

  it("does NOT render an 'Add task' footer button (round-19c removal)", () => {
    // Regression guard: the column footer "+ Add task" button was removed
    // in round 19c. The empty-state button is the in-column entry; further
    // creation flows route through the global task-create dialog.
    renderColumn({ tasks: [makeTask()] });
    expect(screen.queryByText(/Add task/i)).toBeNull();
  });

  it("exposes the column drag handle with an accessible name and is keyboard-reachable", () => {
    // F-01 of docs/audit/kanban-frontend-audit.md (ctq-75) — the drag
    // handle must NOT carry tabIndex=-1 anymore.
    renderColumn();
    // Match either RU or EN — ctq-76 i18n pass replaces RU with EN, so
    // accept both to keep this test stable across the rolling translation.
    const handle = screen.getByRole("button", {
      name: /(перетащить колонку|drag column)/i,
    });
    expect(handle).toBeInTheDocument();
    expect(handle).not.toHaveAttribute("tabindex", "-1");
  });

  it("places a section landmark with the column name as accessible label", () => {
    const { container } = render(
      <DragDropProvider>
        <KanbanColumn
          column={makeColumn({ name: "Done" })}
          index={2}
          tasks={[]}
          onTaskSelect={vi.fn()}
          onAddTask={vi.fn()}
          onRenameColumn={vi.fn()}
          onDeleteColumn={vi.fn()}
        />
      </DragDropProvider>,
    );
    const section = container.querySelector("section[aria-label='Column Done']");
    expect(section).not.toBeNull();
  });
});
