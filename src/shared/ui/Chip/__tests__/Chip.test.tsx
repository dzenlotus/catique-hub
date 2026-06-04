import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChipRoot, ChipSwatch, ChipLabel, ChipRemove } from "../Chip";

describe("Chip primitive", () => {
  it("ChipSwatch renders an aria-hidden swatch with the colour", () => {
    render(<ChipSwatch color="#ff0000" />);
    const swatch = document.querySelector("[aria-hidden='true']");
    expect(swatch).not.toBeNull();
    expect((swatch as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("ChipSwatch renders nothing when color is null", () => {
    const { container } = render(<ChipSwatch color={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("ChipSwatch renders nothing when color is undefined", () => {
    const { container } = render(<ChipSwatch />);
    expect(container.firstChild).toBeNull();
  });

  it("ChipLabel renders its children", () => {
    render(<ChipLabel>frontend</ChipLabel>);
    expect(screen.getByText("frontend")).toBeInTheDocument();
  });

  it("ChipRemove fires onClick and stops propagation", async () => {
    const onClick = vi.fn();
    const onParentClick = vi.fn();
    const user = userEvent.setup();
    render(
      <div onClick={onParentClick}>
        <ChipRemove aria-label="Remove React" onClick={onClick} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Remove React" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("ChipRemove exposes the aria-label and optional testid", () => {
    render(
      <ChipRemove
        aria-label="Remove Vue"
        onClick={vi.fn()}
        data-testid="chip-remove-vue"
      />,
    );
    const btn = screen.getByTestId("chip-remove-vue");
    expect(btn).toHaveAttribute("aria-label", "Remove Vue");
  });

  it("ChipRoot renders a span wrapper with children + testid", () => {
    render(
      <ChipRoot data-testid="chip-root" hasRemove>
        <ChipLabel>backend</ChipLabel>
      </ChipRoot>,
    );
    const root = screen.getByTestId("chip-root");
    expect(root.tagName).toBe("SPAN");
    expect(root).toHaveTextContent("backend");
  });
});
