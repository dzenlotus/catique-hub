import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

const ALL_ICONS: IconName[] = [
  "catique",
  "side-projects",
  "engineering",
  "boards",
  "roadmap",
  "agent-ops",
  "agent-roles",
  "prompts",
  "prompt-groups",
  "skills",
  "mcp-servers",
  "settings",
  "mascot",
];

describe("Icon", () => {
  it.each(ALL_ICONS)("renders without crashing — %s", (name) => {
    const { container } = render(<Icon name={name} aria-hidden={true} />);
    const span = container.querySelector("span");
    expect(span).toBeInTheDocument();
  });

  it("applies aria-hidden when specified", () => {
    const { container } = render(<Icon name="boards" aria-hidden={true} />);
    expect(container.querySelector("span")).toHaveAttribute("aria-hidden", "true");
  });

  it("applies aria-label and role=img when aria-label is provided", () => {
    render(<Icon name="settings" aria-label="Настройки" />);
    expect(screen.getByRole("img", { name: "Настройки" })).toBeInTheDocument();
  });

  it("uses default size 16 px", () => {
    const { container } = render(<Icon name="boards" aria-hidden={true} />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.style.width).toBe("16px");
    expect(span.style.height).toBe("16px");
  });

  it("applies custom size", () => {
    const { container } = render(<Icon name="mascot" size={96} aria-hidden={true} />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.style.width).toBe("96px");
    expect(span.style.height).toBe("96px");
  });

  it("does not add active class by default", () => {
    const { container } = render(<Icon name="boards" aria-hidden={true} />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.className).not.toMatch(/active/);
  });

  it("adds active class when active=true", () => {
    const { container } = render(<Icon name="boards" active={true} aria-hidden={true} />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.className).toMatch(/active/);
  });

  it("forwards className", () => {
    const { container } = render(
      <Icon name="settings" className="custom-class" aria-hidden={true} />,
    );
    expect(container.querySelector("span")).toHaveClass("custom-class");
  });

  it("has backgroundSize style set (sprite layout)", () => {
    const { container } = render(<Icon name="boards" aria-hidden={true} />);
    const span = container.querySelector("span") as HTMLElement;
    // In JSDOM, CSS module url() imports resolve to empty string, but the
    // inline style dimensions from the sprite calculation should still be set.
    expect(span.style.backgroundSize).not.toBe("");
    expect(span.style.backgroundPosition).not.toBe("");
  });
});
