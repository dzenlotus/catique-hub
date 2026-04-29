import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useTaskSelection } from "./useTaskSelection";

describe("useTaskSelection", () => {
  it("starts with an empty selection", () => {
    const { result } = renderHook(() => useTaskSelection());
    expect(result.current.selected.size).toBe(0);
    expect(result.current.selectionActive).toBe(false);
  });

  it("toggle adds an id when not present", () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.toggle("a"));
    expect(result.current.selected.has("a")).toBe(true);
    expect(result.current.selectionActive).toBe(true);
  });

  it("toggle removes an id when already present", () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("a"));
    expect(result.current.selected.has("a")).toBe(false);
    expect(result.current.selectionActive).toBe(false);
  });

  it("isSelected returns correct value", () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.toggle("x"));
    expect(result.current.isSelected("x")).toBe(true);
    expect(result.current.isSelected("y")).toBe(false);
  });

  it("select adds multiple ids without clearing existing", () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.toggle("a"));
    act(() => result.current.select(["b", "c"]));
    expect(result.current.selected.has("a")).toBe(true);
    expect(result.current.selected.has("b")).toBe(true);
    expect(result.current.selected.has("c")).toBe(true);
  });

  it("clear empties the selection", () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.select(["a", "b", "c"]));
    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);
    expect(result.current.selectionActive).toBe(false);
  });

  describe("selectRange", () => {
    const ids = ["t1", "t2", "t3", "t4", "t5"];

    it("selects from start to end (ascending)", () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => result.current.selectRange("t2", "t4", ids));
      expect([...result.current.selected]).toEqual(
        expect.arrayContaining(["t2", "t3", "t4"]),
      );
      expect(result.current.selected.size).toBe(3);
    });

    it("selects from end to start (descending anchor)", () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => result.current.selectRange("t4", "t2", ids));
      expect([...result.current.selected]).toEqual(
        expect.arrayContaining(["t2", "t3", "t4"]),
      );
      expect(result.current.selected.size).toBe(3);
    });

    it("falls back to single-select when fromId is not found", () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => result.current.selectRange("unknown", "t3", ids));
      expect(result.current.selected.has("t3")).toBe(true);
      expect(result.current.selected.size).toBe(1);
    });

    it("falls back to single-select when toId is not found", () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => result.current.selectRange("t1", "ghost", ids));
      // "ghost" not found — only ghost added (but it's not in ids either)
      // According to implementation, toId is added directly when not found.
      expect(result.current.selected.has("ghost")).toBe(true);
    });

    it("handles same fromId and toId (single element)", () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => result.current.selectRange("t3", "t3", ids));
      expect(result.current.selected.has("t3")).toBe(true);
      expect(result.current.selected.size).toBe(1);
    });

    it("does not clear existing selection when ranging", () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => result.current.toggle("t5"));
      act(() => result.current.selectRange("t1", "t2", ids));
      // t5 still in selection + t1, t2 added
      expect(result.current.selected.has("t5")).toBe(true);
      expect(result.current.selected.has("t1")).toBe(true);
      expect(result.current.selected.has("t2")).toBe(true);
    });
  });
});
