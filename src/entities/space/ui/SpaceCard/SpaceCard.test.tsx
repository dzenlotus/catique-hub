import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Space } from "../../model/types";
import { SpaceCard } from "./SpaceCard";

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "spc-001",
    name: "Engineering",
    prefix: "eng",
    description: null,
    isDefault: false,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("SpaceCard", () => {
  it("renders the space name", () => {
    render(<SpaceCard space={makeSpace({ name: "Design" })} />);
    expect(screen.getByText("Design")).toBeInTheDocument();
  });

  it("renders the prefix badge", () => {
    render(<SpaceCard space={makeSpace({ prefix: "des" })} />);
    expect(screen.getByLabelText("Prefix: des")).toBeInTheDocument();
  });

  it("renders the position chip", () => {
    render(<SpaceCard space={makeSpace({ position: 3 })} />);
    expect(screen.getByLabelText("Position rank")).toHaveTextContent("#3");
  });

  it("renders the description when non-null and non-empty", () => {
    render(
      <SpaceCard
        space={makeSpace({ description: "All engineering work lives here." })}
      />,
    );
    expect(
      screen.getByText("All engineering work lives here."),
    ).toBeInTheDocument();
  });

  it("does not render description when description is null", () => {
    render(<SpaceCard space={makeSpace({ description: null })} />);
    // No extra text span beyond the name, prefix, and position.
    expect(screen.queryByText(/engineering work/i)).not.toBeInTheDocument();
  });

  it("does not render description when description is an empty string", () => {
    render(<SpaceCard space={makeSpace({ description: "" })} />);
    // Only name, prefix badge, and position should be present — no extra spans.
    // We verify the description span is absent by checking nothing between
    // the name and the meta row contains visible description text.
    const button = screen.getByRole("button");
    const spans = button.querySelectorAll("span");
    // Expected spans: name, meta, prefixBadge, position = 4
    expect(spans).toHaveLength(4);
  });

  it("renders the default marker when isDefault is true", () => {
    render(<SpaceCard space={makeSpace({ isDefault: true })} />);
    expect(screen.getByLabelText("Default space")).toBeInTheDocument();
  });

  it("does not render the default marker when isDefault is false", () => {
    render(<SpaceCard space={makeSpace({ isDefault: false })} />);
    expect(screen.queryByLabelText("Default space")).not.toBeInTheDocument();
  });

  it("uses a native <button> with implicit role=button (a11y)", () => {
    render(<SpaceCard space={makeSpace()} />);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onSelect on click with the space id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SpaceCard space={makeSpace({ id: "spc-xyz" })} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("spc-xyz");
  });

  it("fires onSelect when activated with the Enter key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SpaceCard
        space={makeSpace({ id: "spc-enter" })}
        onSelect={onSelect}
      />,
    );
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("spc-enter");
  });

  it("fires onSelect when activated with the Space key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SpaceCard
        space={makeSpace({ id: "spc-space-key" })}
        onSelect={onSelect}
      />,
    );
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("spc-space-key");
  });

  it("renders a skeleton when isPending", () => {
    render(<SpaceCard isPending />);
    expect(screen.getByTestId("space-card-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a skeleton when no space is provided", () => {
    render(<SpaceCard />);
    expect(screen.getByTestId("space-card-skeleton")).toBeInTheDocument();
  });
});
