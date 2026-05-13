/**
 * EntityListSidebar — unit tests covering the round-22 nested-children
 * variant. The flat path is exercised in-situ by every page that
 * mounts the sidebar; this file focuses on the new expandable-row
 * behaviour so future regressions show up locally.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EntityListSidebar } from "./EntityListSidebar";
import type { EntityListSidebarItem } from "./EntityListSidebar";

function makeProps(overrides: {
  items: ReadonlyArray<EntityListSidebarItem>;
  selectedId?: string | null;
  expandedIds?: ReadonlyArray<string>;
  onSelect?: (id: string) => void;
  onToggleExpand?: (id: string) => void;
}) {
  return {
    title: "MCP",
    ariaLabel: "MCP servers navigation",
    items: overrides.items,
    selectedId: overrides.selectedId ?? null,
    onSelect: overrides.onSelect ?? vi.fn(),
    addLabel: "Add MCP server",
    onAdd: vi.fn(),
    emptyText: "No MCP servers yet.",
    testIdPrefix: "test-sidebar",
    expandedIds: overrides.expandedIds ?? [],
    onToggleExpand: overrides.onToggleExpand ?? vi.fn(),
  };
}

describe("EntityListSidebar — nested children", () => {
  it("renders a chevron toggle on items that supply `children` (even when empty)", () => {
    render(
      <EntityListSidebar
        {...makeProps({
          items: [{ id: "a", name: "Example", children: [] }],
        })}
      />,
    );
    expect(
      screen.getByTestId("test-sidebar-toggle-a"),
    ).toBeInTheDocument();
  });

  it("does NOT render a chevron when the item omits `children`", () => {
    render(
      <EntityListSidebar
        {...makeProps({
          items: [{ id: "a", name: "Example" }],
        })}
      />,
    );
    expect(
      screen.queryByTestId("test-sidebar-toggle-a"),
    ).not.toBeInTheDocument();
  });

  it("renders nested child rows when the parent is in expandedIds", () => {
    render(
      <EntityListSidebar
        {...makeProps({
          items: [
            {
              id: "a",
              name: "Server A",
              children: [
                { id: "t-1", name: "tool_1" },
                { id: "t-2", name: "tool_2" },
              ],
            },
          ],
          expandedIds: ["a"],
        })}
      />,
    );
    expect(
      screen.getByTestId("test-sidebar-children-a"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("test-sidebar-row-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("test-sidebar-row-t-2")).toBeInTheDocument();
  });

  it("hides nested child rows when the parent is NOT in expandedIds", () => {
    render(
      <EntityListSidebar
        {...makeProps({
          items: [
            {
              id: "a",
              name: "Server A",
              children: [{ id: "t-1", name: "tool_1" }],
            },
          ],
          expandedIds: [],
        })}
      />,
    );
    expect(
      screen.queryByTestId("test-sidebar-children-a"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("test-sidebar-row-t-1"),
    ).not.toBeInTheDocument();
  });

  it("fires onToggleExpand when the chevron is clicked, without firing onSelect", async () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();
    render(
      <EntityListSidebar
        {...makeProps({
          items: [
            {
              id: "a",
              name: "Server A",
              children: [{ id: "t-1", name: "tool_1" }],
            },
          ],
          onSelect,
          onToggleExpand,
        })}
      />,
    );
    await user.click(screen.getByTestId("test-sidebar-toggle-a"));
    expect(onToggleExpand).toHaveBeenCalledWith("a");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("fires onSelect with the child id when a nested row is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <EntityListSidebar
        {...makeProps({
          items: [
            {
              id: "a",
              name: "Server A",
              children: [{ id: "t-1", name: "tool_1" }],
            },
          ],
          expandedIds: ["a"],
          onSelect,
        })}
      />,
    );
    await user.click(screen.getByTestId("test-sidebar-row-t-1"));
    expect(onSelect).toHaveBeenCalledWith("t-1");
  });
});
