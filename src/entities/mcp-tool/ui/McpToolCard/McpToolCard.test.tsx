import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { McpTool } from "../../model/types";
import { McpToolCard } from "./McpToolCard";

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    id: "tool-001",
    name: "My MCP Tool",
    description: "Does something useful.",
    schemaJson: "{}",
    color: null,
    position: 0,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("McpToolCard", () => {
  it("renders the tool name", () => {
    render(<McpToolCard tool={makeTool({ name: "Search Tool" })} />);
    expect(screen.getByText("Search Tool")).toBeInTheDocument();
  });

  it("renders the description preview when description is non-null and non-empty", () => {
    render(
      <McpToolCard
        tool={makeTool({ description: "Fetches search results." })}
      />,
    );
    expect(screen.getByText("Fetches search results.")).toBeInTheDocument();
  });

  it("does not render the description preview when description is null", () => {
    render(<McpToolCard tool={makeTool({ description: null })} />);
    expect(screen.queryByText(/fetches/i)).not.toBeInTheDocument();
  });

  it("does not render the description preview when description is empty string", () => {
    const { container } = render(<McpToolCard tool={makeTool({ description: "" })} />);
    // descriptionPreview span should not exist when description is empty.
    const descriptions = container.querySelectorAll("[class*='descriptionPreview']");
    expect(descriptions).toHaveLength(0);
  });

  it("always renders the tool badge", () => {
    render(<McpToolCard tool={makeTool()} />);
    expect(screen.getByText("tool")).toBeInTheDocument();
  });

  it("always renders the JSON hint", () => {
    render(<McpToolCard tool={makeTool()} />);
    expect(screen.getByText("JSON")).toBeInTheDocument();
  });

  it("renders a color swatch when tool.color is set", () => {
    render(<McpToolCard tool={makeTool({ color: "#ff5733" })} />);
    expect(screen.getByLabelText("Color: #ff5733")).toBeInTheDocument();
  });

  it("does not render a color swatch when tool.color is null", () => {
    render(<McpToolCard tool={makeTool({ color: null })} />);
    expect(screen.queryByLabelText(/цвет/i)).not.toBeInTheDocument();
  });

  it("uses a native <button> with implicit role=button (a11y)", () => {
    render(<McpToolCard tool={makeTool()} />);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onSelect on click with the tool id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<McpToolCard tool={makeTool({ id: "tool-xyz" })} onSelect={onSelect} />);
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("tool-xyz");
  });

  it("fires onSelect when activated with the Enter key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<McpToolCard tool={makeTool({ id: "tool-enter" })} onSelect={onSelect} />);
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("tool-enter");
  });

  it("fires onSelect when activated with the Space key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<McpToolCard tool={makeTool({ id: "tool-space" })} onSelect={onSelect} />);
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("tool-space");
  });

  it("renders a skeleton when isPending", () => {
    render(<McpToolCard isPending />);
    expect(screen.getByTestId("mcp-tool-card-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a skeleton when no tool is provided", () => {
    render(<McpToolCard />);
    expect(screen.getByTestId("mcp-tool-card-skeleton")).toBeInTheDocument();
  });
});
