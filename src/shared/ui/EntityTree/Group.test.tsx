/**
 * Group — unit tests for the rail's expandable-row primitive.
 *
 * Covers:
 *   - renderContent renders the consumer body
 *   - chevron toggle fires onToggleExpand WITHOUT firing onClick
 *   - chevron aria-expanded mirrors isExpand
 *   - children are mounted ONLY when isExpand=true
 *   - active visual hook lives on the row div, not on the children
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Group } from "./Group";
import { Row } from "./Row";

describe("Group — renderContent", () => {
  it("renders the consumer body alongside the chevron toggle", () => {
    render(
      <ul>
        <Group
          testId="group-a"
          chevronTestId="group-toggle-a"
          renderContent={() => <span>Body</span>}
        />
      </ul>,
    );
    expect(screen.getByTestId("group-a")).toBeInTheDocument();
    expect(screen.getByTestId("group-toggle-a")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});

describe("Group — chevron toggle", () => {
  it("fires onToggleExpand when the chevron is clicked", async () => {
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();
    render(
      <ul>
        <Group
          testId="group-a"
          chevronTestId="group-toggle-a"
          onToggleExpand={onToggleExpand}
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    await user.click(screen.getByTestId("group-toggle-a"));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("clicking the chevron does NOT fire the row's onClick", async () => {
    const onClick = vi.fn();
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();
    render(
      <ul>
        <Group
          testId="group-a"
          chevronTestId="group-toggle-a"
          onClick={onClick}
          onToggleExpand={onToggleExpand}
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    await user.click(screen.getByTestId("group-toggle-a"));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("reflects isExpand on the chevron's aria-expanded", () => {
    const { rerender } = render(
      <ul>
        <Group
          testId="group-a"
          chevronTestId="group-toggle-a"
          isExpand={false}
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    expect(screen.getByTestId("group-toggle-a")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    rerender(
      <ul>
        <Group
          testId="group-a"
          chevronTestId="group-toggle-a"
          isExpand
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    expect(screen.getByTestId("group-toggle-a")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("Group — children", () => {
  it("does NOT mount children when isExpand=false", () => {
    render(
      <ul>
        <Group
          testId="group-a"
          chevronTestId="group-toggle-a"
          isExpand={false}
          childrenTestId="group-children-a"
          renderContent={() => <span>x</span>}
        >
          <Row testId="child-1" renderContent={() => <span>Child</span>} />
        </Group>
      </ul>,
    );
    expect(screen.queryByTestId("group-children-a")).not.toBeInTheDocument();
    expect(screen.queryByTestId("child-1")).not.toBeInTheDocument();
  });

  it("mounts children inside the children <ul> when isExpand=true", () => {
    render(
      <ul>
        <Group
          testId="group-a"
          chevronTestId="group-toggle-a"
          isExpand
          childrenTestId="group-children-a"
          renderContent={() => <span>x</span>}
        >
          <Row testId="child-1" renderContent={() => <span>Child</span>} />
        </Group>
      </ul>,
    );
    expect(screen.getByTestId("group-children-a")).toBeInTheDocument();
    expect(screen.getByTestId("child-1")).toBeInTheDocument();
  });
});

describe("Group — active visual", () => {
  it("applies the active class to the row when isActive=true", () => {
    render(
      <ul>
        <Group
          testId="group-a"
          chevronTestId="group-toggle-a"
          isActive
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    const li = screen.getByTestId("group-a");
    const row = li.querySelector('div[class*="row"]');
    expect(row?.className).toMatch(/rowActive/);
  });
});
