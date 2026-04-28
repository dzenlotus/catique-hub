import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Role } from "../../model/types";
import { RoleCard } from "./RoleCard";

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-001",
    name: "Senior Engineer",
    content: "Responsible for architecture decisions.",
    color: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("RoleCard", () => {
  it("renders the role name", () => {
    render(<RoleCard role={makeRole({ name: "Product Manager" })} />);
    expect(screen.getByText("Product Manager")).toBeInTheDocument();
  });

  it("renders the content preview when content is non-empty", () => {
    render(
      <RoleCard
        role={makeRole({ content: "Owns the product roadmap." })}
      />,
    );
    expect(screen.getByText("Owns the product roadmap.")).toBeInTheDocument();
  });

  it("does not render the content preview when content is empty string", () => {
    render(<RoleCard role={makeRole({ content: "" })} />);
    // The preview span should not be present.
    expect(
      screen.queryByText(/roadmap/i),
    ).not.toBeInTheDocument();
  });

  it("truncates content preview beyond 80 characters", () => {
    const long = "A".repeat(100);
    render(<RoleCard role={makeRole({ content: long })} />);
    // Rendered text should be sliced to 80 chars + ellipsis
    expect(screen.getByText(`${"A".repeat(80)}…`)).toBeInTheDocument();
  });

  it("always renders the role badge", () => {
    render(<RoleCard role={makeRole()} />);
    expect(screen.getByText("role")).toBeInTheDocument();
  });

  it("renders a color swatch when role.color is set", () => {
    render(<RoleCard role={makeRole({ color: "#ff5733" })} />);
    expect(screen.getByLabelText("Color: #ff5733")).toBeInTheDocument();
  });

  it("does not render a color swatch when role.color is null", () => {
    render(<RoleCard role={makeRole({ color: null })} />);
    expect(screen.queryByLabelText(/color/i)).not.toBeInTheDocument();
  });

  it("uses a native <button> with implicit role=button (a11y)", () => {
    render(<RoleCard role={makeRole()} />);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onSelect on click with the role id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RoleCard role={makeRole({ id: "role-xyz" })} onSelect={onSelect} />);
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("role-xyz");
  });

  it("fires onSelect when activated with the Enter key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RoleCard role={makeRole({ id: "role-enter" })} onSelect={onSelect} />);
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("role-enter");
  });

  it("fires onSelect when activated with the Space key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RoleCard role={makeRole({ id: "role-space" })} onSelect={onSelect} />);
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("role-space");
  });

  it("renders a skeleton when isPending", () => {
    render(<RoleCard isPending />);
    expect(screen.getByTestId("role-card-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a skeleton when no role is provided", () => {
    render(<RoleCard />);
    expect(screen.getByTestId("role-card-skeleton")).toBeInTheDocument();
  });
});
