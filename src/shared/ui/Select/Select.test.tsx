import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Select, SelectItem } from "./Select";

describe("Select (shared/ui)", () => {
  it("renders the trigger with the visible label and placeholder", () => {
    render(
      <Select label="Board" placeholder="Pick a board">
        <SelectItem id="b1">Sprint Board</SelectItem>
        <SelectItem id="b2">Roadmap</SelectItem>
      </Select>,
    );

    // Visible label is wired via RAC <Label>; trigger button exposes
    // the placeholder text when nothing is selected.
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Board/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pick a board")).toBeInTheDocument();
  });

  it("opens the popover and exposes options as role=option", async () => {
    const user = userEvent.setup();
    render(
      <Select label="Board" placeholder="Pick">
        <SelectItem id="b1">Sprint Board</SelectItem>
        <SelectItem id="b2">Roadmap</SelectItem>
      </Select>,
    );

    // Popover is closed initially — listbox is not in the DOM.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Board/i }));

    // After click, listbox + options are rendered (portalled to body).
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("option", { name: "Sprint Board" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Roadmap" })).toBeInTheDocument();
  });

  it("fires onSelectionChange with the picked item's id", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <Select
        label="Board"
        placeholder="Pick"
        onSelectionChange={handleChange}
      >
        <SelectItem id="b1">Sprint Board</SelectItem>
        <SelectItem id="b2">Roadmap</SelectItem>
      </Select>,
    );

    await user.click(screen.getByRole("button", { name: /Board/i }));
    await user.click(
      await screen.findByRole("option", { name: "Roadmap" }),
    );

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith("b2");
    });
  });

  it("forwards data-testid to the trigger button", () => {
    render(
      <Select label="Role" data-testid="my-select">
        <SelectItem id="r1">Dev</SelectItem>
      </Select>,
    );

    const trigger = screen.getByTestId("my-select");
    expect(trigger.tagName).toBe("BUTTON");
  });

  it("respects isDisabled — clicking does not open the popover", async () => {
    const user = userEvent.setup();
    render(
      <Select label="Role" isDisabled>
        <SelectItem id="r1">Dev</SelectItem>
      </Select>,
    );

    const trigger = screen.getByRole("button", { name: /Role/i });
    expect(trigger).toBeDisabled();

    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders the selected item label when selectedKey is set", () => {
    render(
      <Select label="Board" selectedKey="b1" onSelectionChange={() => {}}>
        <SelectItem id="b1">Sprint Board</SelectItem>
        <SelectItem id="b2">Roadmap</SelectItem>
      </Select>,
    );

    expect(screen.getByRole("button")).toHaveTextContent("Sprint Board");
  });
});
