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
  "tag",
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

  describe("tag icon (sprite col 5, row 1)", () => {
    it("renders a span without crashing", () => {
      const { container } = render(<Icon name="tag" aria-hidden={true} />);
      expect(container.querySelector("span")).toBeInTheDocument();
    });

    it("uses the sprite background-position for cell (5,1)", () => {
      const { container } = render(<Icon name="tag" size={16} aria-hidden={true} />);
      const span = container.querySelector("span") as HTMLElement;
      // At size=16: scale = 16/124.7, bgX = -(5 * 140.2 * scale) ≈ -89.9 px
      // The exact value from the component calculation should be non-zero (negative offset).
      const pos = span.style.backgroundPosition;
      expect(pos).not.toBe("");
      // x-offset for column 5 must be negative and nonzero
      const xPx = parseFloat(pos.split(" ")[0]!);
      expect(xPx).toBeLessThan(0);
    });
  });
});
