import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Prompt } from "../../model/types";
import { PromptCard } from "./PromptCard";

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "pmt-001",
    name: "System Prompt",
    content: "You are a helpful assistant.",
    color: null,
    shortDescription: null,
    icon: null,
    tokenCount: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("PromptCard", () => {
  it("renders name", () => {
    render(<PromptCard prompt={makePrompt({ name: "My Prompt" })} />);
    expect(screen.getByText("My Prompt")).toBeInTheDocument();
  });

  it("renders shortDescription when present", () => {
    render(
      <PromptCard
        prompt={makePrompt({ shortDescription: "A short description here" })}
      />,
    );
    expect(screen.getByText("A short description here")).toBeInTheDocument();
  });

  it("does not render shortDescription when null", () => {
    render(<PromptCard prompt={makePrompt({ shortDescription: null })} />);
    // No description text — only name is visible
    expect(screen.queryByText("A short description here")).toBeNull();
  });

  it("renders color swatch when color is present", () => {
    render(<PromptCard prompt={makePrompt({ color: "#ff6347" })} />);
    const swatch = screen.getByLabelText("Color: #ff6347");
    expect(swatch).toBeInTheDocument();
    expect(swatch).toHaveStyle({ backgroundColor: "#ff6347" });
  });

  it("does not render color swatch when color is null", () => {
    render(<PromptCard prompt={makePrompt({ color: null })} />);
    expect(screen.queryByLabelText(/Color:/)).toBeNull();
  });

  it("renders token count chip when tokenCount is present and > 0", () => {
    render(<PromptCard prompt={makePrompt({ tokenCount: 420n })} />);
    expect(screen.getByText("≈420 tokens")).toBeInTheDocument();
  });

  it("does not render token count chip when tokenCount is null", () => {
    render(<PromptCard prompt={makePrompt({ tokenCount: null })} />);
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it("does not render token count chip when tokenCount is 0", () => {
    render(<PromptCard prompt={makePrompt({ tokenCount: 0n })} />);
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it("uses a native <button> with implicit role=button (a11y)", () => {
    render(<PromptCard prompt={makePrompt()} />);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onSelect on click with the prompt id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptCard
        prompt={makePrompt({ id: "pmt-xyz" })}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("pmt-xyz");
  });

  it("fires onSelect when activated with the Enter key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptCard
        prompt={makePrompt({ id: "pmt-enter" })}
        onSelect={onSelect}
      />,
    );
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("pmt-enter");
  });

  it("fires onSelect when activated with the Space key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptCard
        prompt={makePrompt({ id: "pmt-space" })}
        onSelect={onSelect}
      />,
    );
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("pmt-space");
  });

  it("renders a skeleton when isPending", () => {
    render(<PromptCard isPending />);
    expect(screen.getByTestId("prompt-card-skeleton")).toBeInTheDocument();
    // No interactive button in skeleton state.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a skeleton when no prompt is provided", () => {
    render(<PromptCard />);
    expect(screen.getByTestId("prompt-card-skeleton")).toBeInTheDocument();
  });

  it("skeleton has no role attribute leaked (aria-hidden instead)", () => {
    render(<PromptCard isPending />);
    const skeleton = screen.getByTestId("prompt-card-skeleton");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton).not.toHaveAttribute("role");
  });
});
