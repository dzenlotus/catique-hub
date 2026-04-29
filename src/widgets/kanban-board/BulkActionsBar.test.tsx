import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Column } from "@entities/column";
import { BulkActionsBar } from "./BulkActionsBar";

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-1",
    boardId: "brd-1",
    name: "Todo",
    position: 1n,
    roleId: null,
    createdAt: 0n,
    ...overrides,
  };
}

const columns: Column[] = [
  makeColumn({ id: "col-1", name: "Todo" }),
  makeColumn({ id: "col-2", name: "In Progress" }),
  makeColumn({ id: "col-3", name: "Done" }),
];

describe("BulkActionsBar", () => {
  it("is hidden when count is 0", () => {
    render(
      <BulkActionsBar
        count={0}
        columns={columns}
        onMoveTo={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("bulk-actions-bar")).toBeNull();
  });

  it("shows the count label", () => {
    render(
      <BulkActionsBar
        count={3}
        columns={columns}
        onMoveTo={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bulk-actions-count")).toHaveTextContent(
      "3 selected",
    );
  });

  it("shows the bar when count > 0", () => {
    render(
      <BulkActionsBar
        count={1}
        columns={columns}
        onMoveTo={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bulk-actions-bar")).toBeInTheDocument();
  });

  it("calls onClear when the Clear button is clicked", async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(
      <BulkActionsBar
        count={2}
        columns={columns}
        onMoveTo={vi.fn()}
        onDelete={vi.fn()}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByTestId("bulk-actions-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  describe("Move to dropdown", () => {
    it("opens on trigger click and shows all columns", async () => {
      const user = userEvent.setup();
      render(
        <BulkActionsBar
          count={1}
          columns={columns}
          onMoveTo={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("bulk-actions-move-trigger"));
      expect(screen.getByTestId("bulk-actions-move-menu")).toBeInTheDocument();
      expect(
        screen.getByTestId("bulk-actions-move-option-col-1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("bulk-actions-move-option-col-2"),
      ).toBeInTheDocument();
    });

    it("calls onMoveTo with the column id when an option is clicked", async () => {
      const onMoveTo = vi.fn();
      const user = userEvent.setup();
      render(
        <BulkActionsBar
          count={1}
          columns={columns}
          onMoveTo={onMoveTo}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("bulk-actions-move-trigger"));
      await user.click(screen.getByTestId("bulk-actions-move-option-col-2"));
      expect(onMoveTo).toHaveBeenCalledWith("col-2");
    });

    it("closes the dropdown after selecting a column", async () => {
      const user = userEvent.setup();
      render(
        <BulkActionsBar
          count={1}
          columns={columns}
          onMoveTo={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("bulk-actions-move-trigger"));
      await user.click(screen.getByTestId("bulk-actions-move-option-col-1"));
      expect(screen.queryByTestId("bulk-actions-move-menu")).toBeNull();
    });

    it("shows 'No columns' when columns array is empty", async () => {
      const user = userEvent.setup();
      render(
        <BulkActionsBar
          count={1}
          columns={[]}
          onMoveTo={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("bulk-actions-move-trigger"));
      expect(screen.getByText("No columns")).toBeInTheDocument();
    });
  });

  describe("Delete confirmation flow", () => {
    it("shows a confirmation prompt on first click", async () => {
      const onDelete = vi.fn();
      const user = userEvent.setup();
      render(
        <BulkActionsBar
          count={2}
          columns={columns}
          onMoveTo={vi.fn()}
          onDelete={onDelete}
          onClear={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("bulk-actions-delete"));
      // First click: shows confirmation UI
      expect(
        screen.getByTestId("bulk-actions-confirm-label"),
      ).toHaveTextContent("Delete 2 tasks?");
      expect(onDelete).not.toHaveBeenCalled();
    });

    it("calls onDelete on the confirm click", async () => {
      const onDelete = vi.fn();
      const user = userEvent.setup();
      render(
        <BulkActionsBar
          count={1}
          columns={columns}
          onMoveTo={vi.fn()}
          onDelete={onDelete}
          onClear={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("bulk-actions-delete"));
      await user.click(screen.getByTestId("bulk-actions-delete-confirm"));
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("cancels the confirmation and returns to idle state", async () => {
      const onDelete = vi.fn();
      const user = userEvent.setup();
      render(
        <BulkActionsBar
          count={1}
          columns={columns}
          onMoveTo={vi.fn()}
          onDelete={onDelete}
          onClear={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("bulk-actions-delete"));
      await user.click(screen.getByTestId("bulk-actions-delete-cancel"));
      // Back to idle: delete button visible, confirm label gone
      expect(screen.getByTestId("bulk-actions-delete")).toBeInTheDocument();
      expect(screen.queryByTestId("bulk-actions-confirm-label")).toBeNull();
      expect(onDelete).not.toHaveBeenCalled();
    });

    it("uses singular 'task' when count is 1", async () => {
      const user = userEvent.setup();
      render(
        <BulkActionsBar
          count={1}
          columns={columns}
          onMoveTo={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("bulk-actions-delete"));
      expect(screen.getByTestId("bulk-actions-confirm-label")).toHaveTextContent(
        "Delete 1 task?",
      );
    });
  });
});
