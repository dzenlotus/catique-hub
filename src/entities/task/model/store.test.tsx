/**
 * Task store mutation tests.
 *
 * Coverage: cache-invalidation semantics that previously regressed
 * silently (audit F-11). The hook itself is exercised through TanStack
 * Query's mutation runner; assertions target whether the
 * `tasksKeys.prompts(taskId)` query is marked stale on success.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import {
  tasksKeys,
  useAddTaskPromptMutation,
} from "./store";

const invokeMock = vi.mocked(invoke);

function makeWrapper(client: QueryClient): (props: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAddTaskPromptMutation (audit F-11)", () => {
  it("invalidates tasksKeys.prompts(taskId) on success so the chip row refreshes", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

    // Seed the cache with an empty prompt list under the keyed entry.
    client.setQueryData(tasksKeys.prompts("tsk-1"), []);
    const before = client.getQueryState(tasksKeys.prompts("tsk-1"));
    expect(before?.isInvalidated).toBe(false);

    invokeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAddTaskPromptMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: "tsk-1",
        promptId: "prm-9",
        position: 0,
      });
    });

    await waitFor(() => {
      const after = client.getQueryState(tasksKeys.prompts("tsk-1"));
      expect(after?.isInvalidated).toBe(true);
    });

    const addCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "add_task_prompt",
    );
    expect(addCall).toBeDefined();
  });
});
