/**
 * Task store mutation tests — Skills + MCP Tools direct-attachment hooks.
 *
 * Coverage mirrors the prompts pattern in store.test.tsx:
 *   - add_task_skill is called when a skill is added via useSetTaskSkillsMutation
 *   - remove_task_skill is called when a skill is removed
 *   - add_task_mcp_tool / remove_task_mcp_tool behave the same way
 *   - bundle cache is invalidated after each mutation so EffectiveContextPanel
 *     re-renders with updated origin tags
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invoke } from "@shared/api";
import {
  tasksKeys,
  useSetTaskSkillsMutation,
  useSetTaskMcpToolsMutation,
} from "../store";

const invokeMock = vi.mocked(invoke);

function makeWrapper(
  client: QueryClient,
): (props: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function makeClient(gcTime = 0): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime },
      mutations: { retry: false },
    },
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

describe("useSetTaskSkillsMutation", () => {
  it("calls add_task_skill when a skill is added", async () => {
    const client = makeClient();
    // Seed bundle cache so we can verify invalidation
    client.setQueryData(tasksKeys.bundle("tsk-1"), { skills: [] });

    invokeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSetTaskSkillsMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: "tsk-1",
        previous: [],
        next: ["skl-a"],
      });
    });

    const addCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "add_task_skill",
    );
    expect(addCall).toBeDefined();
    expect(addCall?.[1]).toMatchObject({ taskId: "tsk-1", skillId: "skl-a" });
  });

  it("calls remove_task_skill when a skill is removed", async () => {
    const client = makeClient();
    client.setQueryData(tasksKeys.bundle("tsk-1"), { skills: [] });

    invokeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSetTaskSkillsMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: "tsk-1",
        previous: ["skl-a"],
        next: [],
      });
    });

    const removeCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "remove_task_skill",
    );
    expect(removeCall).toBeDefined();
    expect(removeCall?.[1]).toMatchObject({ taskId: "tsk-1", skillId: "skl-a" });
  });

  it("invalidates tasksKeys.bundle(taskId) after mutation", async () => {
    // Use Infinity gcTime so the seeded entry is not garbage-collected
    // between the mutation settle and the assertion.
    const client = makeClient(Infinity);
    client.setQueryData(tasksKeys.bundle("tsk-2"), { skills: [] });

    const before = client.getQueryState(tasksKeys.bundle("tsk-2"));
    expect(before?.isInvalidated).toBe(false);

    invokeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSetTaskSkillsMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: "tsk-2",
        previous: [],
        next: ["skl-b"],
      });
    });

    await waitFor(() => {
      const after = client.getQueryState(tasksKeys.bundle("tsk-2"));
      expect(after?.isInvalidated).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// MCP Tools
// ---------------------------------------------------------------------------

describe("useSetTaskMcpToolsMutation", () => {
  it("calls add_task_mcp_tool when a tool is added", async () => {
    const client = makeClient();
    client.setQueryData(tasksKeys.bundle("tsk-3"), { mcpTools: [] });

    invokeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSetTaskMcpToolsMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: "tsk-3",
        previous: [],
        next: ["mcp-x"],
      });
    });

    const addCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "add_task_mcp_tool",
    );
    expect(addCall).toBeDefined();
    expect(addCall?.[1]).toMatchObject({ taskId: "tsk-3", mcpToolId: "mcp-x" });
  });

  it("calls remove_task_mcp_tool when a tool is removed", async () => {
    const client = makeClient();
    client.setQueryData(tasksKeys.bundle("tsk-3"), { mcpTools: [] });

    invokeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSetTaskMcpToolsMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: "tsk-3",
        previous: ["mcp-x"],
        next: [],
      });
    });

    const removeCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "remove_task_mcp_tool",
    );
    expect(removeCall).toBeDefined();
    expect(removeCall?.[1]).toMatchObject({
      taskId: "tsk-3",
      mcpToolId: "mcp-x",
    });
  });

  it("invalidates tasksKeys.bundle(taskId) after mutation", async () => {
    // Use Infinity gcTime so the seeded entry is not garbage-collected
    // between the mutation settle and the assertion.
    const client = makeClient(Infinity);
    client.setQueryData(tasksKeys.bundle("tsk-4"), { mcpTools: [] });

    const before = client.getQueryState(tasksKeys.bundle("tsk-4"));
    expect(before?.isInvalidated).toBe(false);

    invokeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSetTaskMcpToolsMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: "tsk-4",
        previous: [],
        next: ["mcp-y"],
      });
    });

    await waitFor(() => {
      const after = client.getQueryState(tasksKeys.bundle("tsk-4"));
      expect(after?.isInvalidated).toBe(true);
    });
  });
});
