import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Column } from "@entities/column";
import type { Task } from "@entities/task";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { KanbanColumn } from "./KanbanColumn";

const invokeMock = vi.mocked(invoke);

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
function renderInDnd(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <DndContext>{ui}</DndContext>
      </ToastProvider>
    </QueryClientProvider>,
  );
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

  it("invokes onAddTask with the column id when '+ Add task' is clicked", async () => {
    // Round 17: clicking "+ Add task" no longer reveals an inline form;
    // it forwards the column id to the parent which opens TaskCreateDialog.
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
    expect(onAddTask).toHaveBeenCalledTimes(1);
    expect(onAddTask).toHaveBeenCalledWith("col-add");
  });

  it("hides the '+ Add task' affordance when no onAddTask handler is provided", () => {
    renderInDnd(
      <KanbanColumn column={makeColumn({ id: "col-noadd" })} tasks={[]} />,
    );
    expect(
      screen.queryByTestId("kanban-column-add-task-col-noadd"),
    ).toBeNull();
  });

  it("hides the add-task footer when rendered as drag overlay", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
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

  it("renders a settings button in the column header", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-settings" })}
        tasks={[]}
      />,
    );
    expect(
      screen.getByTestId("kanban-column-settings-col-settings"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Настройки колонки" }),
    ).toBeInTheDocument();
  });

  it("clicking the settings button opens the ColumnEditor dialog", async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-open-settings" })}
        tasks={[]}
      />,
    );

    const settingsBtn = screen.getByTestId("kanban-column-settings-col-open-settings");
    await user.click(settingsBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("column-editor")).toBeInTheDocument();
  });

  it("wraps the column header area with PromptDropZoneColumnHeader droppable", () => {
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-drop-zone", name: "Droppable" })}
        tasks={[]}
      />,
    );
    expect(screen.getByText("Droppable")).toBeInTheDocument();
    expect(
      screen.getByTestId("kanban-column-drag-handle-col-drop-zone"),
    ).toBeInTheDocument();
  });

  it("propagates isDoneColumn=true to TaskCards in a 'Done' column", () => {
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-done", name: "Done" })}
        tasks={[makeTask({ id: "t-done" })]}
      />,
    );
    // TaskCard should render the done checkmark when the column is "Done".
    expect(screen.getByTestId("task-card-done-check")).toBeInTheDocument();
  });

  it("propagates isDoneColumn=true to TaskCards in a Russian 'Готово' column", () => {
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-done-ru", name: "Готово" })}
        tasks={[makeTask({ id: "t-done-ru" })]}
      />,
    );
    expect(screen.getByTestId("task-card-done-check")).toBeInTheDocument();
  });

  it("does not render done checkmarks in non-done columns", () => {
    renderInDnd(
      <KanbanColumn
        column={makeColumn({ id: "col-progress", name: "In progress" })}
        tasks={[makeTask({ id: "t-prog" })]}
      />,
    );
    expect(screen.queryByTestId("task-card-done-check")).toBeNull();
  });
});
