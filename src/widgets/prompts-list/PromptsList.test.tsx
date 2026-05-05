import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Prompt } from "@entities/prompt";
import type { Tag } from "@entities/tag";
import type { PromptTagMapEntry } from "@bindings/PromptTagMapEntry";
import { ToastProvider } from "@app/providers/ToastProvider";
import { LocalStorageStore, jsonCodec } from "@shared/storage";

// Round-19e: storage shape switched to a list of tag ids; key follows.
const activeTagStore = new LocalStorageStore<string[]>({
  key: "catique:prompts:active-tag-ids",
  codec: jsonCodec<string[]>(),
});

// Mock the Tauri invoke wrapper at the shared/api boundary so all four
// async-UI states can be driven without a real IPC channel.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { PromptsList } from "./PromptsList";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement): {
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { client };
}

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prm-1",
    name: "My Prompt",
    content: "You are a helpful assistant.",
    color: null,
    shortDescription: null,
    icon: null,
    examples: [],
    tokenCount: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

/**
 * Set up invoke so `list_prompts` returns `prompts`, `list_tags` returns
 * `tags`, and `list_prompt_tags_map` returns `tagMap`.  All other calls
 * hang forever (safe default — avoids masking unintended IPC calls).
 */
function mockInvoke({
  prompts,
  tags = [],
  tagMap = [],
}: {
  prompts: Prompt[] | "hang" | "error";
  tags?: Tag[];
  tagMap?: PromptTagMapEntry[];
}): void {
  invokeMock.mockImplementation((command: string) => {
    if (command === "list_prompts") {
      if (prompts === "hang") return new Promise(() => {});
      if (prompts === "error") return Promise.reject(new Error("db offline"));
      return Promise.resolve(prompts);
    }
    if (command === "list_tags") return Promise.resolve(tags);
    if (command === "list_prompt_tags_map") return Promise.resolve(tagMap);
    // All other commands (PromptEditor etc.) hang silently.
    return new Promise(() => {});
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  // Clear any persisted filter between tests.
  activeTagStore.remove();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PromptsList", () => {
  it("renders 3 skeleton cards while loading", () => {
    mockInvoke({ prompts: "hang" });
    renderWithClient(<PromptsList />);
    const skeletons = screen.getAllByTestId("prompt-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("shows the create header button always (loading state)", () => {
    mockInvoke({ prompts: "hang" });
    renderWithClient(<PromptsList />);
    expect(screen.getByTestId("prompts-list-create-button")).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", async () => {
    mockInvoke({ prompts: [] });
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(screen.getByTestId("prompts-list-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/no prompts yet/i)).toBeInTheDocument();
  });

  it("renders one PromptCard per prompt when populated", async () => {
    mockInvoke({
      prompts: [
        makePrompt({ id: "prm-1", name: "Summariser" }),
        makePrompt({ id: "prm-2", name: "Code Reviewer" }),
        makePrompt({ id: "prm-3", name: "Translator" }),
      ],
    });
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(screen.getByTestId("prompts-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("Summariser")).toBeInTheDocument();
    expect(screen.getByText("Code Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Translator")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    mockInvoke({ prompts: "error" });
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/db offline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls onSelectPrompt with the prompt id when a card is activated", async () => {
    mockInvoke({
      prompts: [makePrompt({ id: "prm-pick", name: "Pick me" })],
    });
    const onSelectPrompt = vi.fn();
    renderWithClient(<PromptsList onSelectPrompt={onSelectPrompt} />);
    await waitFor(() => {
      expect(screen.getByTestId("prompts-list-grid")).toBeInTheDocument();
    });
    screen.getByText("Pick me").click();
    expect(onSelectPrompt).toHaveBeenCalledWith("prm-pick");
  });

  // ---- Tag filter integration ----------------------------------------

  it("shows prompts-tag-filter above the grid", async () => {
    mockInvoke({ prompts: [] });
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-tag-filter"),
      ).toBeInTheDocument();
    });
  });

  it("filters the grid to prompts that have the selected tag", async () => {
    // Pre-seed the persisted filter so the grid mounts with t1 active —
    // round-19f swapped the chip-row UI for a react-aria ComboBox, so
    // driving the filter via clicks would fight the popover lifecycle
    // in jsdom. The persisted-state path exercises the same selector
    // logic without coupling to the new combobox internals.
    activeTagStore.set(["t1"]);
    mockInvoke({
      prompts: [
        makePrompt({ id: "prm-a", name: "Alpha" }),
        makePrompt({ id: "prm-b", name: "Beta" }),
      ],
      tags: [{ id: "t1", name: "rust", color: null, createdAt: 0n, updatedAt: 0n }],
      tagMap: [{ promptId: "prm-a", tagIds: ["t1"] }],
    });
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it('shows filter-empty state with "Clear filter" CTA when filter yields no results', async () => {
    activeTagStore.set(["t1"]);
    mockInvoke({
      prompts: [makePrompt({ id: "prm-a", name: "Alpha" })],
      tags: [{ id: "t1", name: "rust", color: null, createdAt: 0n, updatedAt: 0n }],
      tagMap: [], // no prompt has this tag
    });
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-list-filter-empty"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/no prompts match the filter/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear filter/i }),
    ).toBeInTheDocument();
  });
});
