import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState, type ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Tag } from "@entities/tag";

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
      expect(
        screen.getByTestId("prompts-tag-filter-chip-t1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-tag-filter-chip-t2"),
    ).toBeInTheDocument();
  });

  it("renders no chips when nothing is selected", async () => {
    const tags = [makeTag({ id: "t1", name: "Alpha" })] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    renderWithClient(
      <PromptsTagFilter selectedTagIds={[]} onChange={vi.fn()} />,
    );
    // Wait for tags query to settle, then assert no rendered chip.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("prompts-tag-filter-chip-t1"),
    ).not.toBeInTheDocument();
  });

  it("audit-C: lets the user select multiple tags at once", async () => {
    const tags = [
      makeTag({ id: "t1", name: "Alpha" }),
      makeTag({ id: "t2", name: "Beta" }),
    ] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    const onChange = vi.fn();

    function Harness(): ReactElement {
      const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
      return (
        <PromptsTagFilter
          selectedTagIds={selected}
          onChange={(next) => {
            onChange(next);
            setSelected(next);
          }}
        />
      );
    }

    const user = userEvent.setup();
    renderWithClient(<Harness />);

    // Wait for tags query to settle and the combobox to render.
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Filter prompts by tag" }),
      ).toBeInTheDocument();
    });

    const cb = screen.getByRole("combobox", { name: "Filter prompts by tag" });
    await user.click(cb);
    const optionA = await screen.findByTestId(
      "prompts-tag-filter-option-t1",
    );
    await user.click(optionA);
    expect(onChange).toHaveBeenLastCalledWith(["t1"]);

    await user.click(cb);
    const optionB = await screen.findByTestId(
      "prompts-tag-filter-option-t2",
    );
    await user.click(optionB);
    expect(onChange).toHaveBeenLastCalledWith(["t1", "t2"]);

    // Both chips visible — multi-select, not single-select.
    expect(
      screen.getByTestId("prompts-tag-filter-chip-t1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompts-tag-filter-chip-t2"),
    ).toBeInTheDocument();
  });

  it("audit-C: clearing the selection emits an empty array", async () => {
    const tags = [makeTag({ id: "t1", name: "Alpha" })] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    const onChange = vi.fn();

    function Harness(): ReactElement {
      const [selected, setSelected] = useState<ReadonlyArray<string>>(["t1"]);
      return (
        <PromptsTagFilter
          selectedTagIds={selected}
          onChange={(next) => {
            onChange(next);
            setSelected(next);
          }}
        />
      );
    }

    const user = userEvent.setup();
    renderWithClient(<Harness />);

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-tag-filter-chip-t1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-tag-filter-chip-remove-t1"));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(
      screen.queryByTestId("prompts-tag-filter-chip-t1"),
    ).not.toBeInTheDocument();
  });
});
