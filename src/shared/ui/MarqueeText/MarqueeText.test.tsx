import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarqueeText } from "./MarqueeText";

describe("MarqueeText", () => {
  it("renders the text once when content fits", () => {
    render(<MarqueeText text="Short" />);
    // Without overflow, only the primary copy is mounted — the marquee
    // clone shows up only when ResizeObserver detects an overflow.
    expect(screen.getAllByText("Short")).toHaveLength(1);
  });

  it("forwards the text to the title attribute on the viewport", () => {
    const { container } = render(<MarqueeText text="Tooltipped" />);
    const viewport = container.firstChild as HTMLElement;
    expect(viewport.getAttribute("title")).toBe("Tooltipped");
  });

  it("merges a consumer className onto the viewport", () => {
    const { container } = render(
      <MarqueeText text="X" className="consumer-class" />,
    );
    const viewport = container.firstChild as HTMLElement;
    expect(viewport.className).toContain("consumer-class");
  });
});
