import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Board } from "../../model/types";
import { BoardCard } from "./BoardCard";

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-001",
    name: "Roadmap",
    spaceId: "spc-default",
    roleId: null,
    position: 1,
    description: null,
    ownerRoleId: "maintainer-system",
    // ts-rs emits BigInt for i64 — bindings/Board.ts uses bigint
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("BoardCard", () => {
  it("renders name, space badge, and position rank", () => {
    render(<BoardCard board={makeBoard({ name: "Sprint 14", position: 3 })} />);
    expect(screen.getByText("Sprint 14")).toBeInTheDocument();
    expect(screen.getByText("spc-default")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  it("uses a native <button> with implicit role=button (a11y)", () => {
    render(<BoardCard board={makeBoard()} />);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onSelect on click with the board id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<BoardCard board={makeBoard({ id: "brd-xyz" })} onSelect={onSelect} />);
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("brd-xyz");
  });

  it("fires onSelect when activated with the Enter key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<BoardCard board={makeBoard({ id: "brd-enter" })} onSelect={onSelect} />);
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("brd-enter");
  });

  it("fires onSelect when activated with the Space key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<BoardCard board={makeBoard({ id: "brd-space" })} onSelect={onSelect} />);
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("brd-space");
  });

  it("renders a skeleton when isPending", () => {
    render(<BoardCard isPending />);
    expect(screen.getByTestId("board-card-skeleton")).toBeInTheDocument();
    // No interactive button when in skeleton state.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a skeleton when no board is provided", () => {
    render(<BoardCard />);
    expect(screen.getByTestId("board-card-skeleton")).toBeInTheDocument();
  });
});
