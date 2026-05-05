import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnHeader } from "./ColumnHeader";

describe("ColumnHeader", () => {
  it("renders name and count badge", () => {
    render(<ColumnHeader id="col-1" name="In progress" taskCount={4} />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByTestId("column-header-count")).toHaveTextContent("4");
  });

  it("uses singular tasks-label for count of 1, plural otherwise", () => {
    const { rerender } = render(
      <ColumnHeader id="col-1" name="Done" taskCount={1} />,
    );
    expect(screen.getByLabelText(/^1 task$/i)).toBeInTheDocument();

    rerender(<ColumnHeader id="col-1" name="Done" taskCount={3} />);
    expect(screen.getByLabelText(/^3 tasks$/i)).toBeInTheDocument();
  });

  it("renders a column icon for each header", () => {
    render(<ColumnHeader id="col-1" name="Backlog" taskCount={0} />);
    expect(screen.getByTestId("column-header-icon")).toBeInTheDocument();
  });

  it("renders the done checkmark for 'Done' column", () => {
    render(<ColumnHeader id="col-done" name="Done" taskCount={2} />);
    expect(screen.getByTestId("column-header-done-check")).toBeInTheDocument();
  });

  it("renders the done checkmark for Russian 'Готово' column", () => {
    render(<ColumnHeader id="col-done-ru" name="Готово" taskCount={1} />);
    expect(screen.getByTestId("column-header-done-check")).toBeInTheDocument();
  });

  it("does not render done checkmark for non-done columns", () => {
    render(<ColumnHeader id="col-progress" name="In progress" taskCount={3} />);
    expect(screen.queryByTestId("column-header-done-check")).toBeNull();
  });

  it("opens the more-menu on click and exposes Rename + Delete items", async () => {
    const user = userEvent.setup();
    render(<ColumnHeader id="col-1" name="Backlog" taskCount={0} />);
    await user.click(screen.getByRole("button", { name: /column actions/i }));

    expect(
      await screen.findByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /delete/i }),
    ).toBeInTheDocument();
  });

  it("hides the Attach prompt menu item when onAttachPrompt is not provided", async () => {
    const user = userEvent.setup();
    render(<ColumnHeader id="col-1" name="Backlog" taskCount={0} />);
    await user.click(screen.getByRole("button", { name: /column actions/i }));

    expect(
      await screen.findByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /attach prompt/i }),
    ).not.toBeInTheDocument();
  });

  it("invokes onAttachPrompt(id) when the Attach prompt menu item is picked", async () => {
    const onAttachPrompt = vi.fn();
    const user = userEvent.setup();
    render(
      <ColumnHeader
        id="col-1"
        name="Backlog"
        taskCount={0}
        onAttachPrompt={onAttachPrompt}
      />,
    );
    await user.click(screen.getByRole("button", { name: /column actions/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /attach prompt/i }),
    );
    expect(onAttachPrompt).toHaveBeenCalledTimes(1);
    expect(onAttachPrompt).toHaveBeenCalledWith("col-1");
  });

  it("requires confirmation before invoking onDelete", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <ColumnHeader
        id="col-doomed"
        name="To be removed"
        taskCount={2}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByRole("button", { name: /column actions/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /delete/i }),
    );

    // Confirmation dialog open — onDelete not yet called.
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/delete column\?/i)).toBeInTheDocument();

    // Confirm via the dialog's primary button.
    await user.click(screen.getByTestId("column-header-confirm-delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("col-doomed");
  });
});
