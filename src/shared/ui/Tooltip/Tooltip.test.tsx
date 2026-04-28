import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button";
import { Tooltip, TooltipTrigger } from "./Tooltip";

function IconButtonWithTooltip({ tip = "Delete" }: { tip?: string }) {
  return (
    <TooltipTrigger delay={0} closeDelay={0}>
      <Button aria-label={tip}>X</Button>
      <Tooltip>{tip}</Tooltip>
    </TooltipTrigger>
  );
}

describe("Tooltip", () => {
  it("does not render the tooltip until trigger is focused", () => {
    render(<IconButtonWithTooltip />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows on focus and exposes role=tooltip", async () => {
    const user = userEvent.setup();
    render(<IconButtonWithTooltip tip="Delete row" />);
    await user.tab();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Delete row");
  });

  it("hides on Escape", async () => {
    const user = userEvent.setup();
    render(<IconButtonWithTooltip tip="Delete" />);
    await user.tab();
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("links the trigger via aria-describedby when shown", async () => {
    const user = userEvent.setup();
    render(<IconButtonWithTooltip tip="Save" />);
    await user.tab();
    const tip = await screen.findByRole("tooltip");
    const trigger = screen.getByRole("button", { name: "Save" });
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
  });

  it("hides when focus leaves the trigger", async () => {
    const user = userEvent.setup();
    render(
      <>
        <IconButtonWithTooltip />
        <button type="button">Other</button>
      </>,
    );
    await user.tab();
    await screen.findByRole("tooltip");
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
