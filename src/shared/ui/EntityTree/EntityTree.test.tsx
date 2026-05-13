/**
 * EntityTree — unit tests for the declarative tree-list primitive.
 *
 * Covers:
 *   - Flat list (no children).
 *   - Tree with depth-2 nesting.
 *   - Chevron toggle vs row select isolation.
 *   - Disabled rows suppress clicks.
 *   - Strikethrough rows pick up the line-through style.
 *   - `renderRow` escape hatch replaces the declarative layout.
 *   - Empty / loading / error states.
 *   - `data-testid` shape stays stable across the rail.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EntityTree } from "./EntityTree";
import type { EntityTreeNode } from "./types";

interface MakePropsOverrides {
  nodes: ReadonlyArray<EntityTreeNode>;
  selectedId?: string | null;
  expandedIds?: ReadonlyArray<string>;
  onSelect?: (id: string) => void;
  onToggleExpand?: (id: string) => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  title?: string;
  emptyText?: string;
  renderRow?: React.ComponentProps<typeof EntityTree>["renderRow"];
}

function makeProps(overrides: MakePropsOverrides) {
  return {
    title: overrides.title ?? "ROLES",
    ariaLabel: "Roles navigation",
    nodes: overrides.nodes,
    selectedId: overrides.selectedId ?? null,
    expandedIds: overrides.expandedIds ?? [],
    onToggleExpand: overrides.onToggleExpand ?? vi.fn(),
    onSelect: overrides.onSelect ?? vi.fn(),
    addLabel: "Add role",
    onAdd: vi.fn(),
    emptyText: overrides.emptyText ?? "No roles yet.",
    testIdPrefix: "test-tree",
    isLoading: overrides.isLoading ?? false,
    errorMessage: overrides.errorMessage ?? null,
    ...(overrides.renderRow !== undefined ? { renderRow: overrides.renderRow } : {}),
  };
}

describe("EntityTree — flat list", () => {
  it("renders one row per node and the section label", () => {
    render(
      <EntityTree
        {...makeProps({
          nodes: [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
        })}
      />,
    );
    expect(screen.getByText(/^ROLES$/)).toBeInTheDocument();
    expect(screen.getByTestId("test-tree-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("test-tree-row-b")).toBeInTheDocument();
  });

  it("does NOT render a chevron toggle for leaf nodes (no `children`)", () => {
    render(
      <EntityTree
        {...makeProps({ nodes: [{ id: "a", label: "Alpha" }] })}
      />,
    );
    expect(screen.queryByTestId("test-tree-toggle-a")).not.toBeInTheDocument();
  });

  it("fires onSelect with the node id when a row is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <EntityTree
        {...makeProps({
          nodes: [{ id: "a", label: "Alpha" }],
          onSelect,
        })}
      />,
    );
    await user.click(screen.getByTestId("test-tree-row-a"));
    expect(onSelect).toHaveBeenCalledWith("a", expect.objectContaining({ id: "a" }));
  });
});

describe("EntityTree — nesting", () => {
  const nested: EntityTreeNode[] = [
    {
      id: "p1",
      label: "Parent 1",
      children: [
        { id: "c1", label: "Child 1" },
        { id: "c2", label: "Child 2" },
      ],
    },
  ];

  it("renders a chevron on expandable nodes (even with empty children)", () => {
    render(
      <EntityTree
        {...makeProps({
          nodes: [{ id: "a", label: "Alpha", children: [] }],
        })}
      />,
    );
    expect(screen.getByTestId("test-tree-toggle-a")).toBeInTheDocument();
  });

  it("mounts child rows when the parent is in expandedIds", () => {
    render(
      <EntityTree {...makeProps({ nodes: nested, expandedIds: ["p1"] })} />,
    );
    expect(screen.getByTestId("test-tree-children-p1")).toBeInTheDocument();
    expect(screen.getByTestId("test-tree-row-c1")).toBeInTheDocument();
    expect(screen.getByTestId("test-tree-row-c2")).toBeInTheDocument();
  });

  it("hides child rows when the parent is NOT in expandedIds", () => {
    render(<EntityTree {...makeProps({ nodes: nested, expandedIds: [] })} />);
    expect(screen.queryByTestId("test-tree-children-p1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("test-tree-row-c1")).not.toBeInTheDocument();
  });

  it("fires onToggleExpand without firing onSelect when the chevron is clicked", async () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();
    render(
      <EntityTree
        {...makeProps({ nodes: nested, onSelect, onToggleExpand })}
      />,
    );
    await user.click(screen.getByTestId("test-tree-toggle-p1"));
    expect(onToggleExpand).toHaveBeenCalledWith("p1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("fires onSelect with the child id when a nested row is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <EntityTree
        {...makeProps({ nodes: nested, expandedIds: ["p1"], onSelect })}
      />,
    );
    await user.click(screen.getByTestId("test-tree-row-c1"));
    expect(onSelect).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "c1" }));
  });
});

describe("EntityTree — disabled + strikethrough", () => {
  it("suppresses onSelect on disabled rows", async () => {
    const onSelect = vi.fn();
    // Disabled rows carry both `pointer-events: none` (via the
    // `itemDisabled` class) AND a guard inside the select handler. The
    // CSS layer is the user-visible defence; the JS guard backs it up
    // for programmatic clicks. We opt out of the pointer-events check
    // here so the test exercises the second layer too.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <EntityTree
        {...makeProps({
          nodes: [{ id: "a", label: "Alpha", isDisabled: true }],
          onSelect,
        })}
      />,
    );
    await user.click(screen.getByTestId("test-tree-row-a"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("applies a strike-through class to soft-deleted rows", () => {
    render(
      <EntityTree
        {...makeProps({
          nodes: [{ id: "a", label: "Alpha", strikethrough: true }],
        })}
      />,
    );
    const row = screen.getByTestId("test-tree-row-a");
    // The strike style is applied to the `MarqueeText` viewport — find
    // it via the row's descendant tree rather than computed styles
    // (jsdom doesn't resolve CSS Module class composition).
    expect(row.querySelector('[class*="labelStrikethrough"]')).not.toBeNull();
  });
});

describe("EntityTree — renderRow escape hatch", () => {
  it("replaces the declarative body when `renderRow` is provided", () => {
    render(
      <EntityTree
        {...makeProps({
          nodes: [{ id: "a", label: "Alpha" }],
          renderRow: ({ node }) => (
            <button type="button" data-testid={`custom-${node.id}`}>
              {node.label} (custom)
            </button>
          ),
        })}
      />,
    );
    expect(screen.getByTestId("custom-a")).toBeInTheDocument();
    expect(screen.queryByTestId("test-tree-row-a")).not.toBeInTheDocument();
  });

  it("threads toggleExpand + select handlers into the renderRow args", async () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();
    render(
      <EntityTree
        {...makeProps({
          nodes: [{ id: "a", label: "Alpha", children: [] }],
          onSelect,
          onToggleExpand,
          renderRow: ({ node, select, toggleExpand }) => (
            <div>
              <button type="button" onClick={select} data-testid={`sel-${node.id}`}>
                select
              </button>
              <button
                type="button"
                onClick={toggleExpand}
                data-testid={`toggle-${node.id}`}
              >
                toggle
              </button>
            </div>
          ),
        })}
      />,
    );
    await user.click(screen.getByTestId("sel-a"));
    expect(onSelect).toHaveBeenCalledWith("a", expect.objectContaining({ id: "a" }));
    await user.click(screen.getByTestId("toggle-a"));
    expect(onToggleExpand).toHaveBeenCalledWith("a");
  });
});

describe("EntityTree — loading / error / empty", () => {
  it("renders the loading placeholder when isLoading=true", () => {
    render(
      <EntityTree
        {...makeProps({ nodes: [{ id: "a", label: "Alpha" }], isLoading: true })}
      />,
    );
    expect(screen.queryByTestId("test-tree-row-a")).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders the error message in an alert region", () => {
    render(
      <EntityTree
        {...makeProps({ nodes: [], errorMessage: "Failed to load roles" })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/failed to load roles/i);
  });

  it("renders the empty-state copy when nodes is empty", () => {
    render(
      <EntityTree {...makeProps({ nodes: [], emptyText: "No roles yet." })} />,
    );
    expect(screen.getByText(/no roles yet/i)).toBeInTheDocument();
  });

  it("hides the add-trigger while loading", () => {
    render(
      <EntityTree
        {...makeProps({ nodes: [{ id: "a", label: "Alpha" }], isLoading: true })}
      />,
    );
    expect(screen.queryByTestId("test-tree-add")).not.toBeInTheDocument();
  });

  it("renders the add-trigger when the body has loaded", () => {
    render(
      <EntityTree {...makeProps({ nodes: [{ id: "a", label: "Alpha" }] })} />,
    );
    expect(screen.getByTestId("test-tree-add")).toBeInTheDocument();
  });

  it("exposes the section ariaLabel on the root", () => {
    render(
      <EntityTree {...makeProps({ nodes: [{ id: "a", label: "Alpha" }] })} />,
    );
    expect(
      screen.getByRole("complementary", { name: /roles navigation/i }),
    ).toBeInTheDocument();
  });
});
