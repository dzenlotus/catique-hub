/**
 * useGroupedMcpToolSelect — combined MCP server + group + tool SelectTag
 * adapter. Entity hooks mocked; tests option composition, member/server
 * hiding, server labelling, and onChange demultiplexing.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useGroupedMcpToolSelect } from "../useGroupedMcpToolSelect";

const useMcpToolsMock = vi.fn();
const useMcpServersMock = vi.fn();
const useMcpToolGroupsMock = vi.fn();
const useMcpToolGroupMembersMapMock = vi.fn();

vi.mock("@entities/mcp-tool", () => ({
  useMcpTools: () => useMcpToolsMock(),
}));
vi.mock("@entities/mcp-server", () => ({
  useMcpServers: () => useMcpServersMock(),
}));
vi.mock("../../model", () => ({
  useMcpToolGroups: () => useMcpToolGroupsMock(),
  useMcpToolGroupMembersMap: (ids: string[]) =>
    useMcpToolGroupMembersMapMock(ids),
}));

function tool(id: string, name: string, serverId: string | null) {
  return { id, name, description: null, serverId };
}

beforeEach(() => {
  useMcpToolsMock.mockReturnValue({
    data: [
      tool("t1", "resolve-library-id", "srv1"),
      tool("t2", "get-docs", "srv1"),
      tool("t9", "manual", null),
    ],
  });
  useMcpServersMock.mockReturnValue({ data: [{ id: "srv1", name: "Context7" }] });
  useMcpToolGroupsMock.mockReturnValue({ data: [{ id: "g1", name: "Kit", color: null }] });
  useMcpToolGroupMembersMapMock.mockReturnValue({});
});

const noop = {
  onChangeTools: vi.fn(),
  onChangeGroups: vi.fn(),
  onChangeServers: vi.fn(),
};

describe("useGroupedMcpToolSelect", () => {
  it("lists servers, then groups, then tools (tools labelled by server)", () => {
    const { result } = renderHook(() =>
      useGroupedMcpToolSelect({
        attachedToolIds: [],
        attachedGroupIds: [],
        attachedServerIds: [],
        ...noop,
      }),
    );
    expect(result.current.options.map((o) => o.id)).toEqual([
      "server:srv1",
      "group:g1",
      "t1",
      "t2",
      "t9",
    ]);
    // t1's description is its server name (the "distinguish tools" ask).
    const t1 = result.current.options.find((o) => o.id === "t1");
    expect(t1?.description).toBe("Context7");
  });

  it("hides a server's tools when the server is attached", () => {
    const { result } = renderHook(() =>
      useGroupedMcpToolSelect({
        attachedToolIds: [],
        attachedGroupIds: [],
        attachedServerIds: ["srv1"],
        ...noop,
      }),
    );
    // t1 + t2 belong to srv1 → hidden; manual t9 stays.
    expect(result.current.options.map((o) => o.id)).toEqual([
      "server:srv1",
      "group:g1",
      "t9",
    ]);
    expect(result.current.values).toEqual(["server:srv1"]);
  });

  it("routes a server toggle to onChangeServers only", () => {
    const onChangeServers = vi.fn();
    const onChangeTools = vi.fn();
    const onChangeGroups = vi.fn();
    const { result } = renderHook(() =>
      useGroupedMcpToolSelect({
        attachedToolIds: ["t9"],
        attachedGroupIds: [],
        attachedServerIds: [],
        onChangeTools,
        onChangeGroups,
        onChangeServers,
      }),
    );
    result.current.onChange(["server:srv1", "t9"]);
    expect(onChangeServers).toHaveBeenCalledWith(["srv1"]);
    expect(onChangeTools).not.toHaveBeenCalled();
    expect(onChangeGroups).not.toHaveBeenCalled();
  });
});
