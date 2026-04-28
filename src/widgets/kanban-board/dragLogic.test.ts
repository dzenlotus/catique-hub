import { describe, expect, it } from "vitest";

import {
  computeNewPosition,
  computeNewPositionRelativeTo,
  isNoOpDrop,
  reorderColumnIds,
  type PositionedItem,
} from "./dragLogic";

const items = (...positions: number[]): PositionedItem[] =>
  positions.map((p, i) => ({ id: `id-${i}`, position: p }));

describe("dragLogic.computeNewPosition", () => {
  it("returns 1 when dropping into an empty column", () => {
    expect(computeNewPosition([], 0)).toBe(1);
  });

  it("returns first.position - 1 when dropping at the start", () => {
    expect(computeNewPosition(items(2, 3, 4), 0)).toBe(1);
  });

  it("returns last.position + 1 when dropping at the end", () => {
    expect(computeNewPosition(items(2, 3, 4), 3)).toBe(5);
  });

  it("returns the midpoint between two siblings", () => {
    expect(computeNewPosition(items(2, 4), 1)).toBe(3);
    expect(computeNewPosition(items(1, 2), 1)).toBe(1.5);
    expect(computeNewPosition(items(1, 1.5), 1)).toBe(1.25);
  });

  it("clamps a too-large targetIndex to append", () => {
    expect(computeNewPosition(items(1, 2), 99)).toBe(3);
  });

  it("clamps a negative targetIndex to prepend", () => {
    expect(computeNewPosition(items(2, 3), -5)).toBe(1);
  });

  it("supports float positions without re-numbering siblings", () => {
    // Drop between 1.5 and 1.75
    expect(computeNewPosition(items(1.5, 1.75), 1)).toBe(1.625);
  });

  it("dropping into a single-item column at index 0 prepends", () => {
    expect(computeNewPosition(items(5), 0)).toBe(4);
  });

  it("dropping into a single-item column at index 1 appends", () => {
    expect(computeNewPosition(items(5), 1)).toBe(6);
  });
});

describe("dragLogic.computeNewPositionRelativeTo", () => {
  it("inserts before the target by default", () => {
    const list = items(10, 20, 30);
    // before id-1 (position 20) → between id-0 (10) and id-1 (20) = 15
    expect(computeNewPositionRelativeTo(list, "id-1")).toBe(15);
  });

  it("inserts after the target when placement=after", () => {
    const list = items(10, 20, 30);
    // after id-1 (20) → between id-1 (20) and id-2 (30) = 25
    expect(computeNewPositionRelativeTo(list, "id-1", "after")).toBe(25);
  });

  it("returns null when the target id is missing", () => {
    expect(computeNewPositionRelativeTo(items(1, 2), "ghost")).toBeNull();
  });

  it("inserts at the very end when placement=after on the last item", () => {
    const list = items(10, 20);
    expect(computeNewPositionRelativeTo(list, "id-1", "after")).toBe(21);
  });
});

describe("dragLogic.isNoOpDrop", () => {
  it("flags a drop onto self as no-op", () => {
    expect(
      isNoOpDrop({
        draggedId: "t1",
        sourceColumnId: "c1",
        sourcePosition: 1,
        targetColumnId: "c1",
        targetPosition: 1,
        overId: "t1",
      }),
    ).toBe(true);
  });

  it("flags an unchanged column+position drop as no-op", () => {
    expect(
      isNoOpDrop({
        draggedId: "t1",
        sourceColumnId: "c1",
        sourcePosition: 5,
        targetColumnId: "c1",
        targetPosition: 5,
      }),
    ).toBe(true);
  });

  it("rejects a cross-column drop even at same position number", () => {
    expect(
      isNoOpDrop({
        draggedId: "t1",
        sourceColumnId: "c1",
        sourcePosition: 1,
        targetColumnId: "c2",
        targetPosition: 1,
      }),
    ).toBe(false);
  });

  it("rejects a same-column drop at a different position", () => {
    expect(
      isNoOpDrop({
        draggedId: "t1",
        sourceColumnId: "c1",
        sourcePosition: 1,
        targetColumnId: "c1",
        targetPosition: 2,
      }),
    ).toBe(false);
  });
});

describe("dragLogic.reorderColumnIds", () => {
  const cols = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("moves a column to the start", () => {
    expect(reorderColumnIds(cols, "c", "a")).toEqual(["c", "a", "b", "d"]);
  });

  it("moves a column to the end", () => {
    expect(reorderColumnIds(cols, "a", "d")).toEqual(["b", "c", "d", "a"]);
  });

  it("moves a column to a middle position", () => {
    expect(reorderColumnIds(cols, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("returns null when active === over", () => {
    expect(reorderColumnIds(cols, "b", "b")).toBeNull();
  });

  it("returns null when an id is missing", () => {
    expect(reorderColumnIds(cols, "ghost", "a")).toBeNull();
    expect(reorderColumnIds(cols, "a", "ghost")).toBeNull();
  });

  it("preserves the rest of the order when moving the leftmost column right", () => {
    expect(reorderColumnIds(cols, "a", "b")).toEqual(["b", "a", "c", "d"]);
  });

  it("handles a 2-column board", () => {
    expect(reorderColumnIds([{ id: "x" }, { id: "y" }], "x", "y")).toEqual([
      "y",
      "x",
    ]);
  });
});
