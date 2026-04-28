import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button";
import { Menu, MenuItem, MenuTrigger, Separator } from "./Menu";

function CardMenu({ onAction }: { onAction?: (key: string) => void }) {
  return (
    <MenuTrigger>
      <Button>Actions</Button>
      <Menu
        aria-label="row actions"
        onAction={(key) => onAction?.(String(key))}
      >
        <MenuItem id="rename">Rename</MenuItem>
        <MenuItem id="duplicate">Duplicate</MenuItem>
        <Separator />
        <MenuItem id="delete" variant="danger">
          Delete
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

describe("Menu", () => {
  it("opens on trigger press and exposes menuitems", async () => {
    const user = userEvent.setup();
    render(<CardMenu />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<CardMenu />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("focuses the first item when opened", async () => {
    const user = userEvent.setup();
    render(<CardMenu />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Rename" }),
    );
  });

  it("ArrowDown moves focus through menu items", async () => {
    const user = userEvent.setup();
    render(<CardMenu />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Duplicate" }),
    );
  });

  it("Enter on a focused item fires onAction with its id and closes the menu", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<CardMenu onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    // First item is auto-focused; one ArrowDown moves to "Duplicate".
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onAction).toHaveBeenCalledWith("duplicate");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders a separator with role=separator", async () => {
    const user = userEvent.setup();
    render(<CardMenu />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("danger item is rendered (visual variant doesn't break a11y semantics)", async () => {
    const user = userEvent.setup();
    render(<CardMenu />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });
});
