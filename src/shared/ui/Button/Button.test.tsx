import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./Button";

describe("Button", () => {
  it("renders the label and a native <button>", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("forwards `onPress` from RAC and fires on click", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(<Button onPress={onPress}>Click me</Button>);
    await user.click(screen.getByRole("button", { name: "Click me" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders a spinner and disables the button while pending", () => {
    const onPress = vi.fn();
    render(
      <Button isPending onPress={onPress} variant="primary">
        Saving
      </Button>,
    );
    const btn = screen.getByRole("button", { name: /saving/i });
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
  });

  it("does not fire onPress when isDisabled", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(
      <Button isDisabled onPress={onPress}>
        Off
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Off" }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
