import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Tag } from "@entities/tag";

// Mock the Tauri invoke wrapper so tests never touch a real IPC channel.
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
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("PromptsTagFilter", () => {
  it('renders the "All" chip when tags are loading', () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onChange = vi.fn();
    renderWithClient(
      <PromptsTagFilter selectedTagIds={[]} onChange={onChange} />,
    );
    expect(screen.getByTestId("prompts-tag-filter-all")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("renders one chip per tag when tags are loaded", async () => {
    const tags = [
      makeTag({ id: "t1", name: "Alpha" }),
      makeTag({ id: "t2", name: "Beta" }),
    ] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    renderWithClient(
      <PromptsTagFilter selectedTagIds={[]} onChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it('fires onChange([]) when the "All" chip is clicked', async () => {
    invokeMock.mockResolvedValue([] satisfies Tag[]);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithClient(
      <PromptsTagFilter selectedTagIds={["some-tag"]} onChange={onChange} />,
    );
    await user.click(screen.getByTestId("prompts-tag-filter-all"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("toggles a tag id into the selection when its chip is clicked", async () => {
    const tags = [makeTag({ id: "t-click", name: "Clickable" })] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithClient(
      <PromptsTagFilter selectedTagIds={[]} onChange={onChange} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Clickable")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("prompts-tag-filter-chip-t-click"));
    expect(onChange).toHaveBeenCalledWith(["t-click"]);
  });

  it("toggles a selected tag back off when the chip is clicked again", async () => {
    const tags = [makeTag({ id: "t-toggle", name: "Toggle" })] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithClient(
      <PromptsTagFilter selectedTagIds={["t-toggle"]} onChange={onChange} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Toggle")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("prompts-tag-filter-chip-t-toggle"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("supports multiple tag selections", async () => {
    const tags = [
      makeTag({ id: "t1", name: "Alpha" }),
      makeTag({ id: "t2", name: "Beta" }),
    ] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithClient(
      <PromptsTagFilter selectedTagIds={["t1"]} onChange={onChange} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("prompts-tag-filter-chip-t2"));
    expect(onChange).toHaveBeenCalledWith(["t1", "t2"]);
  });

  it('marks the "All" chip aria-pressed when no tags are selected', async () => {
    invokeMock.mockResolvedValue([] satisfies Tag[]);
    renderWithClient(
      <PromptsTagFilter selectedTagIds={[]} onChange={vi.fn()} />,
    );
    const allChip = screen.getByTestId("prompts-tag-filter-all");
    expect(allChip).toHaveAttribute("aria-pressed", "true");
  });

  it("marks each selected tag chip aria-pressed", async () => {
    const tags = [makeTag({ id: "t-pressed", name: "Pressed" })] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    renderWithClient(
      <PromptsTagFilter
        selectedTagIds={["t-pressed"]}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Pressed")).toBeInTheDocument();
    });
    const chip = screen.getByTestId("prompts-tag-filter-chip-t-pressed");
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("renders a colour swatch for tags with a non-null color", async () => {
    const tags = [
      makeTag({ id: "t-color", name: "Red", color: "#ff0000" }),
    ] satisfies Tag[];
    invokeMock.mockResolvedValue(tags);
    renderWithClient(
      <PromptsTagFilter selectedTagIds={[]} onChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Red")).toBeInTheDocument();
    });
    const chip = screen.getByTestId("prompts-tag-filter-chip-t-color");
    const swatch = chip.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });
});
