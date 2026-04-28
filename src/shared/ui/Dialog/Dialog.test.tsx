import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button";
import { Dialog, DialogTrigger } from "./Dialog";

describe("Dialog", () => {
  it("opens on trigger press and exposes the title", async () => {
    const user = userEvent.setup();
    render(
      <DialogTrigger>
        <Button>Open</Button>
        <Dialog title="Confirm action" description="This cannot be undone.">
          <p>Body</p>
        </Dialog>
      </DialogTrigger>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Confirm action" }),
    ).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("closes on Escape press by default", async () => {
    const user = userEvent.setup();
    render(
      <DialogTrigger>
        <Button>Open</Button>
        <Dialog title="Closable">
          <p>Body</p>
        </Dialog>
      </DialogTrigger>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { hidden: false }),
    ).not.toBeInTheDocument();
  });

  it("supports a render-prop child receiving close()", async () => {
    const user = userEvent.setup();
    render(
      <DialogTrigger>
        <Button>Open</Button>
        <Dialog title="Render-prop">
          {(close) => (
            <Button variant="primary" onPress={close}>
              Done
            </Button>
          )}
        </Dialog>
      </DialogTrigger>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(
      screen.queryByRole("dialog", { hidden: false }),
    ).not.toBeInTheDocument();
  });
});
