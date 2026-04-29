import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title text", () => {
    render(<EmptyState title="No items yet" description="Create your first item." />);
    expect(screen.getByText("No items yet")).toBeInTheDocument();
  });

  it("renders the description text", () => {
    render(<EmptyState title="No items yet" description="Create your first item." />);
    expect(screen.getByText("Create your first item.")).toBeInTheDocument();
  });

  it("renders the root element with data-testid empty-state", () => {
    render(<EmptyState title="No items" description="Nothing here." />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("renders an action node when provided", () => {
    render(
      <EmptyState
        title="No items"
        description="Nothing here."
        action={<button type="button">Create</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("does not render an action slot when action is undefined", () => {
    const { container } = render(
      <EmptyState title="No items" description="Nothing here." />,
    );
    // No buttons in the component
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("renders the icon wrapper when iconName is provided", () => {
    const { container } = render(
      <EmptyState
        iconName="prompts"
        title="No prompts"
        description="Create your first prompt."
      />,
    );
    // iconWrap span is aria-hidden and contains the Icon span
    const iconWrap = container.querySelector("[aria-hidden='true']");
    expect(iconWrap).toBeInTheDocument();
  });

  it("does not render an icon wrapper when iconName is omitted", () => {
    const { container } = render(
      <EmptyState title="No prompts" description="Create one." />,
    );
    // The Icon span has inline background-image; no icon wrappers should be present
    const spans = container.querySelectorAll("span");
    expect(spans).toHaveLength(0);
  });

  it("applies a custom className to the root element", () => {
    const { container } = render(
      <EmptyState
        title="No items"
        description="Nothing here."
        className="my-custom-class"
      />,
    );
    expect(container.firstChild).toHaveClass("my-custom-class");
  });
});
