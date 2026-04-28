import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Combobox, type ComboboxItem } from "./Combobox";

const PROMPTS: ComboboxItem[] = [
  { id: "p1", label: "Frontend dev brief" },
  { id: "p2", label: "Backend dev brief" },
  { id: "p3", label: "Tech analyst" },
];

describe("Combobox", () => {
  it("renders combobox role with associated label", () => {
    render(<Combobox label="Prompt" items={PROMPTS} />);
    const cb = screen.getByRole("combobox", { name: "Prompt" });
    expect(cb).toBeInTheDocument();
  });

  it("opens the listbox on ArrowDown and reveals options", async () => {
    const user = userEvent.setup();
    render(<Combobox label="Prompt" items={PROMPTS} />);
    const cb = screen.getByRole("combobox", { name: "Prompt" });
    cb.focus();
    await user.keyboard("{ArrowDown}");
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters options as user types", async () => {
    const user = userEvent.setup();
    render(<Combobox label="Prompt" items={PROMPTS} />);
    const cb = screen.getByRole("combobox", { name: "Prompt" });
    await user.click(cb);
    await user.type(cb, "back");
    const opts = await screen.findAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent("Backend dev brief");
  });

  it("Enter selects the focused option and commits to the input", async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        label="Prompt"
        items={PROMPTS}
        onSelectionChange={onSelectionChange}
      />,
    );
    const cb = screen.getByRole("combobox", { name: "Prompt" });
    cb.focus();
    // ArrowDown opens popover and pre-focuses the first option (RAC default).
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    // One more ArrowDown moves to the second option ("Backend dev brief"),
    // Enter commits.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelectionChange).toHaveBeenCalledWith("p2");
    expect(cb).toHaveValue("Backend dev brief");
  });

  it("Escape closes the popover", async () => {
    const user = userEvent.setup();
    render(<Combobox label="Prompt" items={PROMPTS} />);
    const cb = screen.getByRole("combobox", { name: "Prompt" });
    cb.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders item detail when provided", async () => {
    const user = userEvent.setup();
    const items: ComboboxItem[] = [
      { id: "x", label: "Alpha", detail: "v1" },
    ];
    render(<Combobox label="Prompt" items={items} />);
    const cb = screen.getByRole("combobox", { name: "Prompt" });
    cb.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    expect(screen.getByText("v1")).toBeInTheDocument();
  });
});
