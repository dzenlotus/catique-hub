import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { IconPicker, IconRenderer } from "./IconPicker";

describe("IconPicker", () => {
  it("renders the trigger with a placeholder when value is null", () => {
    render(
      <IconPicker
        value={null}
        onChange={() => {}}
        data-testid="picker"
      />,
    );
    const trigger = screen.getByTestId("picker");
    expect(trigger).toHaveTextContent("+");
  });

  it("forwards aria-label to the trigger", () => {
    render(
      <IconPicker
        value={null}
        onChange={() => {}}
        ariaLabel="Pick an icon"
        data-testid="picker"
      />,
    );
    expect(screen.getByTestId("picker")).toHaveAttribute(
      "aria-label",
      "Pick an icon",
    );
  });
});

describe("IconRenderer", () => {
  it("returns null for an unknown icon name", () => {
    const { container } = render(<IconRenderer name="DefinitelyNotAnIcon" />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null for null/empty inputs", () => {
    const { container, rerender } = render(<IconRenderer name={null} />);
    expect(container.firstChild).toBeNull();
    rerender(<IconRenderer name="" />);
    expect(container.firstChild).toBeNull();
  });
});
