/**
 * Task-link store mutation tests (catique-4).
 *
 * Coverage: a successful link / unlink must invalidate the per-task
 * link query for BOTH endpoints — a link surfaces on either task's
 * detail panel, so a one-sided invalidation would leave the peer panel
 * stale until reload.
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
  useLinkTasksMutation,
  useUnlinkTasksMutation,
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

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // gcTime: Infinity — a query seeded via setQueryData has no
      // observer here (only the mutation hook mounts), so gcTime: 0
      // lets it be garbage-collected before the invalidation assertion
      // runs. The race is timing-dependent (passes locally, flakes on
      // slower CI). Each test uses its own throwaway client, so keeping
      // the cache alive for the test's duration leaks nothing.
      queries: { retry: false, gcTime: Infinity },
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

describe("useLinkTasksMutation", () => {
  it("invalidates the link query for both endpoints on success", async () => {
    const client = freshClient();
    client.setQueryData(tasksKeys.links("a"), []);
    client.setQueryData(tasksKeys.links("b"), []);

    invokeMock.mockResolvedValueOnce({
      srcTaskId: "a",
      dstTaskId: "b",
      kind: "blocks",
      createdAt: 1,
    });

    const { result } = renderHook(() => useLinkTasksMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        srcTaskId: "a",
        dstTaskId: "b",
        kind: "blocks",
      });
    });

    await waitFor(() => {
      expect(client.getQueryState(tasksKeys.links("a"))?.isInvalidated).toBe(
        true,
      );
      expect(client.getQueryState(tasksKeys.links("b"))?.isInvalidated).toBe(
        true,
      );
    });
    expect(invokeMock).toHaveBeenCalledWith("link_tasks", {
      srcTaskId: "a",
      dstTaskId: "b",
      kind: "blocks",
    });
  });
});

describe("useUnlinkTasksMutation", () => {
  it("invalidates both endpoints on success", async () => {
    const client = freshClient();
    client.setQueryData(tasksKeys.links("a"), []);
    client.setQueryData(tasksKeys.links("b"), []);

    invokeMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useUnlinkTasksMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        srcTaskId: "a",
        dstTaskId: "b",
        kind: "related",
      });
    });

    await waitFor(() => {
      expect(client.getQueryState(tasksKeys.links("a"))?.isInvalidated).toBe(
        true,
      );
      expect(client.getQueryState(tasksKeys.links("b"))?.isInvalidated).toBe(
        true,
      );
    });
  });
});
