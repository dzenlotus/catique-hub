import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnHeader } from "../ColumnHeader";

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

  it("renders an SVG glyph in the header for each column", () => {
    // Post-migration: the column icon is rendered through EntityTitle's
    // leading slot (static IconRenderer when no `onAppearanceChange` is
    // provided, IconColorPicker trigger otherwise). The exact testid the
    // legacy heuristic used (`column-header-icon`) is gone — we now assert
    // that the header carries a glyph (svg) and the picker affordance.
    render(<ColumnHeader id="col-1" name="Backlog" taskCount={0} />);
    const header = screen.getByTestId("column-header-col-1");
    expect(header.querySelector("svg")).not.toBeNull();
  });

  it("exposes the appearance picker when onAppearanceChange is provided", () => {
    render(
      <ColumnHeader
        id="col-1"
        name="Backlog"
        taskCount={0}
        onAppearanceChange={() => {}}
      />,
    );
    expect(screen.getByTestId("column-header-appearance-col-1")).toBeInTheDocument();
  });

  it("opens the more-menu on click and exposes the Delete item", async () => {
    const user = userEvent.setup();
    render(
      <ColumnHeader
        id="col-1"
        name="Backlog"
        taskCount={0}
        onRename={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /column actions/i }));

    expect(
      await screen.findByRole("menuitem", { name: /delete/i }),
    ).toBeInTheDocument();
    // Rename moved to an inline-editable title button (no menu item).
    expect(
      screen.queryByRole("menuitem", { name: /^rename$/i }),
    ).not.toBeInTheDocument();
  });

  it("exposes the inline rename affordance instead of a menu entry", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(
      <ColumnHeader
        id="col-1"
        name="Backlog"
        taskCount={0}
        onRename={onRename}
      />,
    );
    // The inline-rename trigger carries `aria-label="Rename <name>"`.
    const renameTrigger = screen.getByRole("button", { name: /^rename backlog$/i });
    await user.click(renameTrigger);
    const editor = await screen.findByRole("textbox", { name: /rename/i });
    await user.clear(editor);
    await user.type(editor, "Inbox{Enter}");
    expect(onRename).toHaveBeenCalledWith("col-1", "Inbox");
  });

  it("does not surface a deprecated 'Attach prompt' menu item (audit-#8)", async () => {
    // The column overflow menu lost its `Attach prompt` action when
    // `<AttachPromptDialog>` was retired. The replacement is the
    // column-edit page MultiSelect (audit-F14, deferred). Until that
    // page lands the column header must not advertise a broken option.
    const user = userEvent.setup();
    render(<ColumnHeader id="col-1" name="Backlog" taskCount={0} />);
    await user.click(screen.getByRole("button", { name: /column actions/i }));

    expect(
      screen.queryByRole("menuitem", { name: /attach prompt/i }),
    ).not.toBeInTheDocument();
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
