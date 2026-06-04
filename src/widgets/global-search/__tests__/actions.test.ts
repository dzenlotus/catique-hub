import { describe, expect, it, vi } from "vitest";

import {
  buildActions,
  filterActions,
  type QuickAction,
} from "../actions";

const SPACES = [
  { id: "sp-1", name: "Alpha" },
  { id: "sp-2", name: "Beta" },
];

describe("buildActions", () => {
  it("includes static + dynamic per-space actions", () => {
    const actions = buildActions({ spaces: SPACES });
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("go-spaces");
    expect(ids).toContain("go-agents");
    expect(ids).toContain("sidecar-restart");
    expect(ids).toContain("go-space-sp-1");
    expect(ids).toContain("go-space-sp-2");
  });

  it("produces no per-space actions when spaces are empty", () => {
    const actions = buildActions({ spaces: [] });
    const dyn = actions.filter((a) => a.id.startsWith("go-space-"));
    expect(dyn).toHaveLength(0);
  });
});

describe("filterActions", () => {
  const actions = buildActions({ spaces: SPACES });

  it("returns all actions when query is empty", () => {
    expect(filterActions(actions, "").length).toBe(actions.length);
  });

  it("filters by keyword substring", () => {
    const restart = filterActions(actions, "restart");
    expect(restart.some((a) => a.id === "sidecar-restart")).toBe(true);
    // Non-matching actions are dropped.
    expect(restart.some((a) => a.id === "go-prompts")).toBe(false);
  });

  it("matches space names case-insensitively", () => {
    const result = filterActions(actions, "alpha");
    expect(result[0]?.id).toBe("go-space-sp-1");
  });

  it("returns empty when nothing matches", () => {
    expect(filterActions(actions, "zzz-no-such-thing")).toEqual([]);
  });
});

describe("context-aware actions", () => {
  const prompts = [
    { id: "p-1", name: "Concise" },
    { id: "p-2", name: "Verbose" },
  ];

  it("does not surface task-context actions without currentTaskId", () => {
    const ids = buildActions({ spaces: SPACES, prompts }).map((a) => a.id);
    expect(ids).not.toContain("run-agent-current-task");
    expect(ids).not.toContain("attach-prompt-p-1");
  });

  it("no longer surfaces a 'Run agent' action on a task (feature removed)", () => {
    const ids = buildActions({
      spaces: SPACES,
      prompts,
      currentTaskId: "task-1",
    }).map((a) => a.id);
    expect(ids).not.toContain("run-agent-current-task");
  });

  it("surfaces one attach action per prompt when on a task", () => {
    const ids = buildActions({
      spaces: SPACES,
      prompts,
      currentTaskId: "task-1",
    }).map((a) => a.id);
    expect(ids).toContain("attach-prompt-p-1");
    expect(ids).toContain("attach-prompt-p-2");
  });

  it("attach action title carries the prompt name", () => {
    const action = buildActions({
      spaces: [],
      prompts,
      currentTaskId: "task-1",
    }).find((a) => a.id === "attach-prompt-p-1") as QuickAction;
    expect(action.title).toMatch(/Concise/);
    expect(action.title).toMatch(/this task/i);
  });
});

describe("QuickAction.run", () => {
  it("navigates to the space path for per-space go actions", () => {
    const action = buildActions({ spaces: SPACES }).find(
      (a) => a.id === "go-space-sp-1",
    ) as QuickAction;
    const navigate = vi.fn();
    const toast = vi.fn();
    action.run({ navigate, toast });
    expect(navigate).toHaveBeenCalledWith("/spaces/sp-1");
  });

  it("navigates to integrations for go-integrations", () => {
    const action = buildActions({ spaces: [] }).find(
      (a) => a.id === "go-integrations",
    ) as QuickAction;
    const navigate = vi.fn();
    const toast = vi.fn();
    action.run({ navigate, toast });
    expect(navigate).toHaveBeenCalledWith("/integrations");
  });
});
