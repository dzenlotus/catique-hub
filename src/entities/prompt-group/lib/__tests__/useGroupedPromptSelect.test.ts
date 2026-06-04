/**
 * useGroupedPromptSelect — unit tests for the combined prompt+group
 * SelectTag adapter. The entity hooks it composes are mocked so the test
 * focuses on the pure transformation: option composition, member hiding,
 * and onChange demultiplexing.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useGroupedPromptSelect } from "../useGroupedPromptSelect";

const usePromptsMock = vi.fn();
const usePromptGroupsMock = vi.fn();
const usePromptGroupMembersMapMock = vi.fn();

vi.mock("@entities/prompt", () => ({
  usePrompts: () => usePromptsMock(),
}));

vi.mock("../../model", () => ({
  usePromptGroups: () => usePromptGroupsMock(),
  usePromptGroupMembersMap: (ids: string[]) => usePromptGroupMembersMapMock(ids),
}));

function prompt(id: string, name: string) {
  return { id, name, shortDescription: null };
}
function group(id: string, name: string) {
  return { id, name, color: null };
}

beforeEach(() => {
  usePromptsMock.mockReturnValue({
    data: [prompt("p1", "Codestyle"), prompt("p2", "Tone"), prompt("p3", "Safety")],
  });
  usePromptGroupsMock.mockReturnValue({
    data: [group("g1", "Writing pack")],
  });
  usePromptGroupMembersMapMock.mockReturnValue({ g1: ["p1", "p2"] });
});

describe("useGroupedPromptSelect", () => {
  it("lists groups (prefixed) followed by prompts", () => {
    const { result } = renderHook(() =>
      useGroupedPromptSelect({
        attachedPromptIds: [],
        attachedGroupIds: [],
        onChangePrompts: vi.fn(),
        onChangeGroups: vi.fn(),
      }),
    );
    // With no attached group, no members are hidden → all 3 prompts show.
    const ids = result.current.options.map((o) => o.id);
    expect(ids).toEqual(["group:g1", "p1", "p2", "p3"]);
  });

  it("hides members of an attached group from the prompt list", () => {
    const { result } = renderHook(() =>
      useGroupedPromptSelect({
        attachedPromptIds: [],
        attachedGroupIds: ["g1"],
        onChangePrompts: vi.fn(),
        onChangeGroups: vi.fn(),
      }),
    );
    const ids = result.current.options.map((o) => o.id);
    // p1 + p2 are covered by g1 → hidden; only the group + p3 remain.
    expect(ids).toEqual(["group:g1", "p3"]);
    // The attached group is a chip value.
    expect(result.current.values).toEqual(["group:g1"]);
  });

  it("keeps a member visible when it is also directly attached", () => {
    const { result } = renderHook(() =>
      useGroupedPromptSelect({
        attachedPromptIds: ["p1"],
        attachedGroupIds: ["g1"],
        onChangePrompts: vi.fn(),
        onChangeGroups: vi.fn(),
      }),
    );
    const ids = result.current.options.map((o) => o.id);
    // p1 directly attached → stays; p2 hidden (group-only).
    expect(ids).toContain("p1");
    expect(ids).not.toContain("p2");
    expect(result.current.values).toEqual(["group:g1", "p1"]);
  });

  it("routes a group toggle to onChangeGroups only", () => {
    const onChangePrompts = vi.fn();
    const onChangeGroups = vi.fn();
    const { result } = renderHook(() =>
      useGroupedPromptSelect({
        attachedPromptIds: ["p3"],
        attachedGroupIds: [],
        onChangePrompts,
        onChangeGroups,
      }),
    );
    // Add the group: next = [group:g1, p3].
    result.current.onChange(["group:g1", "p3"]);
    expect(onChangeGroups).toHaveBeenCalledWith(["g1"]);
    expect(onChangePrompts).not.toHaveBeenCalled();
  });

  it("routes a prompt toggle to onChangePrompts only", () => {
    const onChangePrompts = vi.fn();
    const onChangeGroups = vi.fn();
    const { result } = renderHook(() =>
      useGroupedPromptSelect({
        attachedPromptIds: ["p3"],
        attachedGroupIds: ["g1"],
        onChangePrompts,
        onChangeGroups,
      }),
    );
    // Remove p3, keep group: next = [group:g1].
    result.current.onChange(["group:g1"]);
    expect(onChangePrompts).toHaveBeenCalledWith([]);
    expect(onChangeGroups).not.toHaveBeenCalled();
  });
});
