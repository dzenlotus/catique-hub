/**
 * MarkdownField — keyboard interaction & mode-transition contract.
 *
 * Ctq-90: bare focus must NEVER flip view → edit, otherwise tabbing
 * through a form destroys tab order. Edit mode is entered via:
 *   - mouse click on the preview surface
 *   - Enter or Space keypress while the preview is focused
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";

import { MarkdownField } from "./MarkdownField";

// ── Controlled host so we can drive `value` from the test if needed ──────────

function Host({ initial = "" }: { initial?: string }): ReactElement {
  const [value, setValue] = useState<string>(initial);
  return (
    <MarkdownField
      value={value}
      onChange={setValue}
      ariaLabel="Notes"
      data-testid="md-field"
    />
  );
}

describe("MarkdownField", () => {
  it("renders the view-mode preview button by default", () => {
    render(<Host initial="Hello" />);
    expect(screen.getByTestId("md-field")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("tab focus does not enter edit mode (ctq-90)", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">before</button>
        <Host initial="Stay in view" />
        <button type="button">after</button>
      </>,
    );

    // Tab from the leading button onto the preview surface.
    await user.tab(); // focus "before"
    await user.tab(); // focus the MarkdownField preview button

    const preview = screen.getByTestId("md-field");
    expect(preview).toHaveFocus();
    // Mode is still "view" — no textarea has appeared.
    expect(screen.queryByRole("textbox")).toBeNull();

    // Continuing to tab proceeds to the trailing button rather than
    // getting trapped inside an unintentional editor.
    await user.tab();
    expect(screen.getByText("after")).toHaveFocus();
  });

  it("Enter on the focused preview enters edit mode", async () => {
    const user = userEvent.setup();
    render(<Host initial="" />);

    const preview = screen.getByTestId("md-field");
    preview.focus();
    expect(preview).toHaveFocus();
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.keyboard("{Enter}");

    // Edit mode now active — textarea takes over and is auto-focused.
    const textarea = await screen.findByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveFocus();
  });

  it("click on the preview enters edit mode", async () => {
    const user = userEvent.setup();
    render(<Host initial="Some content" />);

    await user.click(screen.getByTestId("md-field"));

    const textarea = await screen.findByRole("textbox");
    expect(textarea).toBeInTheDocument();
  });
});
