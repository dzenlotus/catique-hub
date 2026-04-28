import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Task } from "../../model/types";
import { TaskCard } from "./TaskCard";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk-001",
    boardId: "brd-1",
    columnId: "col-1",
    slug: "tsk-abc123",
    title: "Ship kanban widget",
    description: null,
    position: 1.0,
    roleId: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("TaskCard", () => {
  it("renders title and position rank", () => {
    render(<TaskCard task={makeTask({ title: "Title here", position: 5 })} />);
    expect(screen.getByText("Title here")).toBeInTheDocument();
    expect(screen.getByText("#5")).toBeInTheDocument();
  });

  it("renders the role badge when roleId is set, and not otherwise", () => {
    const { rerender } = render(<TaskCard task={makeTask({ roleId: "anna" })} />);
    expect(screen.getByTestId("task-card-role-badge")).toHaveTextContent(
      "anna",
    );

    rerender(<TaskCard task={makeTask({ roleId: null })} />);
    expect(screen.queryByTestId("task-card-role-badge")).toBeNull();
  });

  it("fires onSelect on click and on Enter activation", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskCard task={makeTask({ id: "tsk-clk" })} onSelect={onSelect} />,
    );
    const btn = screen.getByRole("button");
    await user.click(btn);
    expect(onSelect).toHaveBeenCalledWith("tsk-clk");

    onSelect.mockClear();
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("tsk-clk");
  });

  it("renders attachments badge when count > 0", () => {
    render(
      <TaskCard
        task={makeTask({ id: "tsk-att" })}
        attachmentsCount={3}
      />,
    );
    expect(screen.getByTestId("task-card-attachments")).toHaveTextContent("3");

    // Re-render with 0 — badge gone.
    render(<TaskCard task={makeTask({ id: "tsk-empty" })} attachmentsCount={0} />);
    // queryAll because we have two cards rendered now (ids differ)
    const badges = screen.queryAllByTestId("task-card-attachments");
    expect(badges).toHaveLength(1); // only the first card's badge
  });

  it("renders a skeleton when isPending and exposes no button", () => {
    render(<TaskCard isPending />);
    expect(screen.getByTestId("task-card-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
