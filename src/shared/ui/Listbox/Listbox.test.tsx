import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Listbox, ListboxItem } from "./Listbox";

function ColorListbox({
  selectionMode = "single" as const,
}: {
  selectionMode?: "single" | "multiple";
}) {
  return (
    <Listbox aria-label="colors" selectionMode={selectionMode}>
      <ListboxItem id="red">Red</ListboxItem>
      <ListboxItem id="green">Green</ListboxItem>
      <ListboxItem id="blue">Blue</ListboxItem>
    </Listbox>
  );
}

describe("Listbox", () => {
  it("renders role=listbox with options", () => {
    render(<ColorListbox />);
    expect(screen.getByRole("listbox", { name: "colors" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("clicking an item selects it (single mode)", async () => {
    const user = userEvent.setup();
    render(<ColorListbox />);
    const green = screen.getByRole("option", { name: "Green" });
    await user.click(green);
    expect(green).toHaveAttribute("aria-selected", "true");
  });

  it("supports multiple selection", async () => {
    const user = userEvent.setup();
    render(<ColorListbox selectionMode="multiple" />);
    await user.click(screen.getByRole("option", { name: "Red" }));
    await user.click(screen.getByRole("option", { name: "Blue" }));
    expect(screen.getByRole("option", { name: "Red" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Blue" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Green" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("Tab focuses the first option, ArrowDown moves to the next", async () => {
    const user = userEvent.setup();
    render(<ColorListbox />);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "Red" }),
    );
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "Green" }),
    );
  });

  it("Enter selects the focused option in single mode", async () => {
    const user = userEvent.setup();
    render(<ColorListbox />);
    await user.tab();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("option", { name: "Green" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
