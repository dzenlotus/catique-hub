import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Tag } from "../../model/types";
import { TagChip } from "./TagChip";

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag-001",
    name: "frontend",
    color: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("TagChip", () => {
  it("renders the tag name", () => {
    render(<TagChip tag={makeTag({ name: "backend" })} />);
    expect(screen.getByText("backend")).toBeInTheDocument();
  });

  it("renders a colour swatch when color is non-null", () => {
    render(<TagChip tag={makeTag({ color: "#ff0000" })} />);
    // The swatch is aria-hidden so query by its inline style.
    const swatch = document.querySelector("[aria-hidden='true']");
    expect(swatch).not.toBeNull();
    expect((swatch as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("does not render a swatch when color is null", () => {
    render(<TagChip tag={makeTag({ color: null })} />);
    // No aria-hidden element for the swatch.
    const hiddenEls = document.querySelectorAll("[aria-hidden='true']");
    expect(hiddenEls).toHaveLength(0);
  });

  it("renders as a static <span> when no onSelect is provided", () => {
    render(<TagChip tag={makeTag()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders as a <button> when onSelect is provided", () => {
    render(<TagChip tag={makeTag()} onSelect={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onSelect on click with the tag id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TagChip tag={makeTag({ id: "tag-xyz" })} onSelect={onSelect} />);
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("tag-xyz");
  });

  it("fires onSelect when activated with the Enter key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TagChip tag={makeTag({ id: "tag-enter" })} onSelect={onSelect} />);
    screen.getByRole("button").focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("tag-enter");
  });

  it("fires onSelect when activated with the Space key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TagChip tag={makeTag({ id: "tag-space" })} onSelect={onSelect} />);
    screen.getByRole("button").focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("tag-space");
  });

  it("renders a skeleton when isPending", () => {
    render(<TagChip isPending />);
    expect(screen.getByTestId("tag-chip-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a skeleton when no tag is provided", () => {
    render(<TagChip />);
    expect(screen.getByTestId("tag-chip-skeleton")).toBeInTheDocument();
  });
});
