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
  it("renders title", () => {
    render(<TaskCard task={makeTask({ title: "Title here" })} />);
    expect(screen.getByText("Title here")).toBeInTheDocument();
  });

  it("does NOT render position rank (removed in DS v1)", () => {
    render(<TaskCard task={makeTask({ position: 5 })} />);
    expect(screen.queryByText("#5")).toBeNull();
    expect(screen.queryByLabelText(/position rank/i)).toBeNull();
  });

  it("renders the slug chip with task.slug value", () => {
    render(<TaskCard task={makeTask({ slug: "tsk-xyz99" })} />);
    const chip = screen.getByTestId("task-card-slug-chip");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("tsk-xyz99");
  });

  it("renders the role badge when roleId is set, and not otherwise", () => {
    const { rerender } = render(<TaskCard task={makeTask({ roleId: "anna" })} />);
    expect(screen.getByTestId("task-card-role-badge")).toHaveTextContent(
      "anna",
    );

    rerender(<TaskCard task={makeTask({ roleId: null })} />);
    expect(screen.queryByTestId("task-card-role-badge")).toBeNull();
  });

  it("renders description excerpt when description is non-null", () => {
    render(
      <TaskCard
        task={makeTask({ description: "Some description text here." })}
      />,
    );
    expect(screen.getByText("Some description text here.")).toBeInTheDocument();
  });

  it("does not render description when null", () => {
    render(<TaskCard task={makeTask({ description: null })} />);
    // No paragraph-like element containing description text.
    expect(screen.queryByText(/description/i)).toBeNull();
  });

  it("renders done checkmark when isDoneColumn is true", () => {
    render(<TaskCard task={makeTask()} isDoneColumn />);
    expect(screen.getByTestId("task-card-done-check")).toBeInTheDocument();
  });

  it("does not render done checkmark by default", () => {
    render(<TaskCard task={makeTask()} />);
    expect(screen.queryByTestId("task-card-done-check")).toBeNull();
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
