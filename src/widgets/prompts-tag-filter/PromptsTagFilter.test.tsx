import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Tag } from "@entities/tag";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { PromptsTagFilter } from "./PromptsTagFilter";

const invokeMock = vi.mocked(invoke);

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag-1",
    name: "frontend",
    color: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderWithClient(
  ui: ReactElement,
  client?: QueryClient,
): { client: QueryClient } {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("PromptsTagFilter", () => {
  it("mounts the filter input on every state", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(
      <PromptsTagFilter selectedTagIds={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("prompts-tag-filter")).toBeInTheDocument();
  });

  it("renders a chip for each selected tag id", async () => {
    const tags = [
      makeTag({ id: "t1", name: "Alpha" }),
      makeTag({ id: "t2", name: "Beta" }),
    ] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    renderWithClient(
      <PromptsTagFilter
        selectedTagIds={["t1", "t2"]}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders no chips when nothing is selected", async () => {
    const tags = [makeTag({ id: "t1", name: "Alpha" })] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    renderWithClient(
      <PromptsTagFilter selectedTagIds={[]} onChange={vi.fn()} />,
    );
    // Wait for tags query to settle, then assert no rendered chip text.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });
});
