/**
 * Row — unit tests for the rail's leaf-row primitive.
 *
 * Covers:
 *   - renderContent renders the consumer body
 *   - active visual hook (`.rowActive` class on the row div)
 *   - draggable wiring (handle button + canonical aria-label/testid)
 *   - row onClick fires when the body click bubbles to .row
 *   - drag handle stops propagation so it doesn't fire row onClick
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Row } from "./Row";

describe("Row — renderContent", () => {
  it("renders the consumer body inside the row", () => {
    render(
      <ul>
        <Row
          testId="row-a"
          renderContent={() => <button type="button">Body</button>}
        />
      </ul>,
    );
    expect(screen.getByTestId("row-a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Body" })).toBeInTheDocument();
  });

  it("applies the active class when isActive=true", () => {
    render(
      <ul>
        <Row
          testId="row-a"
          isActive
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    const li = screen.getByTestId("row-a");
    const row = li.querySelector('div[class*="row"]');
    expect(row?.className).toMatch(/rowActive/);
  });

  it("does NOT apply the active class when isActive is omitted", () => {
    render(
      <ul>
        <Row testId="row-a" renderContent={() => <span>x</span>} />
      </ul>,
    );
    const li = screen.getByTestId("row-a");
    const row = li.querySelector('div[class*="row"]');
    expect(row?.className).not.toMatch(/rowActive/);
  });
});

describe("Row — onClick", () => {
  it("fires onClick when the row body is clicked", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <ul>
        <Row
          testId="row-a"
          onClick={onClick}
          renderContent={() => (
            <button type="button" data-testid="row-body">
              Body
            </button>
          )}
        />
      </ul>,
    );
    await user.click(screen.getByTestId("row-body"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Row — draggable", () => {
  it("renders the built-in drag handle when isDraggable", () => {
    render(
      <ul>
        <Row
          testId="row-a"
          isDraggable
          sortableId="a"
          dragHandleTestId="row-handle-a"
          dragHandleAriaLabel="Drag Alpha"
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    expect(screen.getByTestId("row-handle-a")).toBeInTheDocument();
    expect(screen.getByTestId("row-handle-a")).toHaveAttribute(
      "aria-label",
      "Drag Alpha",
    );
  });

  it("does NOT render a handle when isDraggable is false", () => {
    render(
      <ul>
        <Row
          testId="row-a"
          dragHandleTestId="row-handle-a"
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    expect(screen.queryByTestId("row-handle-a")).not.toBeInTheDocument();
  });

  it("clicking the drag handle does NOT fire the row's onClick", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <ul>
        <Row
          testId="row-a"
          isDraggable
          sortableId="a"
          onClick={onClick}
          dragHandleTestId="row-handle-a"
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    await user.click(screen.getByTestId("row-handle-a"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stamps data-draggable on the <li> when isDraggable", () => {
    render(
      <ul>
        <Row
          testId="row-a"
          isDraggable
          sortableId="a"
          renderContent={() => <span>x</span>}
        />
      </ul>,
    );
    expect(screen.getByTestId("row-a")).toHaveAttribute("data-draggable", "true");
  });
});
