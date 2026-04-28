import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Input } from "./Input";

describe("Input", () => {
  it("associates the visible label with the input via accessible name", () => {
    render(<Input label="Email" type="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "email");
  });

  it("accepts user typing", async () => {
    const user = userEvent.setup();
    render(<Input label="Name" />);
    const input = screen.getByLabelText("Name");
    await user.type(input, "Anna");
    expect(input).toHaveValue("Anna");
  });

  it("renders the error message when provided", () => {
    render(<Input label="Token" errorMessage="Token is required." />);
    expect(screen.getByText("Token is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Token")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("renders an optional description without an error", () => {
    render(<Input label="Slug" description="lowercase, hyphens only" />);
    expect(
      screen.getByText("lowercase, hyphens only"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Slug")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
