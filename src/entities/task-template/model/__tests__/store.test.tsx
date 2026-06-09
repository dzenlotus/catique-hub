/**
 * Task-template store tests (catique-1).
 *
 * Coverage: the list query hits `list_task_templates`, and create
 * invalidates the list key so a freshly authored template appears.
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
  taskTemplatesKeys,
  useTaskTemplates,
  useCreateTaskTemplateMutation,
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
      queries: { retry: false, gcTime: 0 },
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

describe("useTaskTemplates", () => {
  it("loads the template list via list_task_templates", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "tmpl-bug",
        name: "Bug",
        kind: "bug",
        description: "",
        body: "## Summary",
        icon: null,
        color: null,
        position: 1,
        createdAt: 0,
        updatedAt: 0,
      },
    ]);

    const { result } = renderHook(() => useTaskTemplates(), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe("Bug");
    expect(invokeMock).toHaveBeenCalledWith("list_task_templates");
  });
});

describe("useCreateTaskTemplateMutation", () => {
  it("invalidates the list on success", async () => {
    const client = freshClient();
    client.setQueryData(taskTemplatesKeys.all, []);
    invokeMock.mockResolvedValueOnce({
      id: "t1",
      name: "Spike",
      kind: "custom",
      description: "",
      body: "",
      icon: null,
      color: null,
      position: 3,
      createdAt: 0,
      updatedAt: 0,
    });

    const { result } = renderHook(() => useCreateTaskTemplateMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: "Spike", kind: "custom" });
    });

    await waitFor(() => {
      expect(client.getQueryState(taskTemplatesKeys.all)?.isInvalidated).toBe(
        true,
      );
    });
  });
});
