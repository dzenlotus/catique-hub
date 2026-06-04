/**
 * McpToolGroupInlineView — smoke coverage. Entity hooks mocked; asserts
 * the member card list + XML preview render for a group with members.
 */

import { render, screen } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ToastProvider } from "@shared/lib";

import { McpToolGroupInlineView } from "../McpToolGroupInlineView";

const useMcpToolGroupMock = vi.fn();
const useMcpToolGroupMembersMock = vi.fn();
const noopMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

vi.mock("@entities/mcp-tool-group", () => ({
  useMcpToolGroup: () => useMcpToolGroupMock(),
  useMcpToolGroupMembers: () => useMcpToolGroupMembersMock(),
  useUpdateMcpToolGroupMutation: () => noopMutation(),
  useDeleteMcpToolGroupMutation: () => noopMutation(),
  useRemoveMcpToolGroupMemberMutation: () => noopMutation(),
}));
vi.mock("@entities/mcp-tool", async () => {
  const actual = await vi.importActual<typeof import("@entities/mcp-tool")>(
    "@entities/mcp-tool",
  );
  return {
    ...actual,
    useMcpTools: () => ({
      data: [
        {
          id: "t1",
          name: "get-docs",
          description: "Fetch docs",
          schemaJson: "{}",
          color: null,
          position: 0,
          serverId: "srv1",
          upstreamName: "get-docs",
          source: "upstream",
        },
      ],
    }),
  };
});
vi.mock("@entities/mcp-server", () => ({
  useMcpServers: () => ({ data: [{ id: "srv1", name: "Context7" }] }),
}));

function renderView() {
  return render(
    <ToastProvider>
      <DragDropProvider>
        <McpToolGroupInlineView groupId="g1" onDeleted={vi.fn()} />
      </DragDropProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  useMcpToolGroupMock.mockReturnValue({
    status: "success",
    data: { id: "g1", name: "Deploy kit", color: null, icon: null },
  });
});

describe("McpToolGroupInlineView", () => {
  it("renders member cards + XML preview with member tools", () => {
    useMcpToolGroupMembersMock.mockReturnValue({ data: ["t1"] });
    renderView();
    expect(
      screen.getByTestId("mcp-tool-group-inline-view-card-t1"),
    ).toBeInTheDocument();
    const xml = screen.getByTestId("mcp-tool-group-inline-view-xml-preview");
    expect(xml.textContent).toContain('<mcp_tools group="Deploy kit">');
    expect(xml.textContent).toContain('name="get-docs"');
    expect(xml.textContent).toContain('server="Context7"');
  });

  it("shows the empty drop-zone hint when the group has no tools", () => {
    useMcpToolGroupMembersMock.mockReturnValue({ data: [] });
    renderView();
    expect(
      screen.getByTestId("mcp-tool-group-inline-view-drop-zone"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mcp-tool-group-inline-view-xml-preview"),
    ).not.toBeInTheDocument();
  });
});
