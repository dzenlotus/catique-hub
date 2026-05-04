import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Skill } from "../../model/types";
import { SkillCard } from "./SkillCard";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-001",
    name: "TypeScript",
    description: null,
    color: null,
    position: 0,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("SkillCard", () => {
  it("renders the skill name", () => {
    render(<SkillCard skill={makeSkill({ name: "React" })} />);
    expect(screen.getByText("React")).toBeInTheDocument();
  });

  it("renders the description preview when description is non-null and non-empty", () => {
    render(
      <SkillCard
        skill={makeSkill({ description: "Знание TypeScript на продвинутом уровне." })}
      />,
    );
    expect(
      screen.getByText("Знание TypeScript на продвинутом уровне."),
    ).toBeInTheDocument();
  });

  it("does not render the description preview when description is null", () => {
    render(<SkillCard skill={makeSkill({ description: null })} />);
    expect(screen.queryByText(/уровне/i)).not.toBeInTheDocument();
  });

  it("does not render the description preview when description is empty string", () => {
    render(<SkillCard skill={makeSkill({ description: "" })} />);
    // No preview span should be visible
    expect(screen.queryByText(/описание/i)).not.toBeInTheDocument();
  });

  it("always renders the skill badge", () => {
    render(<SkillCard skill={makeSkill()} />);
    expect(screen.getByText("skill")).toBeInTheDocument();
  });

  it("renders a color swatch when skill.color is set", () => {
    render(<SkillCard skill={makeSkill({ color: "#3b82f6" })} />);
    expect(screen.getByLabelText("Color: #3b82f6")).toBeInTheDocument();
  });

  it("does not render a color swatch when skill.color is null", () => {
    render(<SkillCard skill={makeSkill({ color: null })} />);
    expect(screen.queryByLabelText(/color/i)).not.toBeInTheDocument();
  });

  it("uses a native <button> with implicit role=button (a11y)", () => {
    render(<SkillCard skill={makeSkill()} />);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onSelect on click with the skill id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SkillCard skill={makeSkill({ id: "skill-xyz" })} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("skill-xyz");
  });

  it("fires onSelect when activated with the Enter key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SkillCard skill={makeSkill({ id: "skill-enter" })} onSelect={onSelect} />,
    );
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("skill-enter");
  });

  it("fires onSelect when activated with the Space key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SkillCard skill={makeSkill({ id: "skill-space" })} onSelect={onSelect} />,
    );
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("skill-space");
  });

  it("renders a skeleton when isPending", () => {
    render(<SkillCard isPending />);
    expect(screen.getByTestId("skill-card-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a skeleton when no skill is provided", () => {
    render(<SkillCard />);
    expect(screen.getByTestId("skill-card-skeleton")).toBeInTheDocument();
  });
});
