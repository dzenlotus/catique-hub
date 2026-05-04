import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Prompt } from "@entities/prompt";
import { ToastProvider } from "@app/providers/ToastProvider";

// Mock Tauri invoke at the shared/api boundary.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { SettingsTokensView } from "./SettingsTokensView";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement): { client: QueryClient } {
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
    name: "Test Prompt",
    content: "System message.",
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

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("SettingsTokensView", () => {
  // ── Loading state ──────────────────────────────────────────────────────

  it("renders skeleton rows while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<SettingsTokensView />);
    expect(screen.getByTestId("settings-tokens-view")).toBeInTheDocument();
    // We render 5 skeleton rows — no data-testid on them, but they have aria-hidden.
    const hiddenRows = document.querySelectorAll('[aria-hidden="true"]');
    expect(hiddenRows.length).toBeGreaterThanOrEqual(5);
  });

  it("shows the heading while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<SettingsTokensView />);
    expect(
      screen.getByRole("heading", { name: /token counts/i }),
    ).toBeInTheDocument();
  });

  // ── Error state ────────────────────────────────────────────────────────

  it("shows an error banner with retry when query fails", async () => {
    invokeMock.mockRejectedValue(new Error("db error"));
    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(screen.getByTestId("settings-tokens-view-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/db error/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  // ── Empty state ────────────────────────────────────────────────────────

  it("shows the empty-state paragraph when list is empty", async () => {
    invokeMock.mockResolvedValue([] satisfies Prompt[]);
    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(screen.getByTestId("settings-tokens-view-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/no prompts yet/i)).toBeInTheDocument();
  });

  // ── Loaded state ───────────────────────────────────────────────────────

  it("renders one row per prompt with correct testid", async () => {
    invokeMock.mockResolvedValue([
      makePrompt({ id: "p1", name: "Alpha" }),
      makePrompt({ id: "p2", name: "Beta" }),
    ] satisfies Prompt[]);
    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(screen.getByTestId("settings-tokens-view-row-p1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("settings-tokens-view-row-p2")).toBeInTheDocument();
  });

  it("shows token count when tokenCount > 0", async () => {
    invokeMock.mockResolvedValue([
      makePrompt({ id: "p1", name: "HasTokens", tokenCount: 42n }),
    ] satisfies Prompt[]);
    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(screen.getByTestId("settings-tokens-view-row-p1")).toBeInTheDocument();
    });
    expect(screen.getByText("≈42 tokens")).toBeInTheDocument();
  });

  it("shows '—' when tokenCount is null", async () => {
    invokeMock.mockResolvedValue([
      makePrompt({ id: "p1", name: "NoTokens", tokenCount: null }),
    ] satisfies Prompt[]);
    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(screen.getByTestId("settings-tokens-view-row-p1")).toBeInTheDocument();
    });
    // The token column cell should show '—'
    const row = screen.getByTestId("settings-tokens-view-row-p1");
    expect(row.textContent).toContain("—");
  });

  it("renders per-row recount button with correct testid", async () => {
    invokeMock.mockResolvedValue([
      makePrompt({ id: "p1", name: "Alpha" }),
    ] satisfies Prompt[]);
    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-tokens-view-row-p1-recount"),
      ).toBeInTheDocument();
    });
  });

  it("renders the bulk recount button", async () => {
    invokeMock.mockResolvedValue([
      makePrompt({ id: "p1", name: "Alpha" }),
    ] satisfies Prompt[]);
    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-tokens-view-bulk-recount"),
      ).toBeInTheDocument();
    });
  });

  // ── Per-row recount mutation ───────────────────────────────────────────

  it("calls recompute_prompt_token_count when per-row button is clicked", async () => {
    const promptList = [makePrompt({ id: "p1", name: "Alpha" })] satisfies Prompt[];
    const updatedPrompt = makePrompt({ id: "p1", tokenCount: 10n });
    // list_prompts → initial list
    invokeMock.mockResolvedValueOnce(promptList);
    // recompute_prompt_token_count → returns updated prompt
    invokeMock.mockResolvedValueOnce(updatedPrompt);
    // list_prompts (cache invalidation refetch) → updated list
    invokeMock.mockResolvedValue(promptList);

    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-tokens-view-row-p1-recount"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("settings-tokens-view-row-p1-recount"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "recompute_prompt_token_count",
        expect.objectContaining({ id: "p1" }),
      );
    });
  });

  // ── Bulk recount ───────────────────────────────────────────────────────

  it("shows progress label during bulk recount", async () => {
    // list_prompts returns two prompts
    invokeMock
      .mockResolvedValueOnce([
        makePrompt({ id: "p1", name: "Alpha" }),
        makePrompt({ id: "p2", name: "Beta" }),
      ] satisfies Prompt[])
      // First recount resolves slowly
      .mockImplementationOnce(
        () =>
          new Promise((res) =>
            setTimeout(
              () => res(makePrompt({ id: "p1", tokenCount: 10n })),
              50,
            ),
          ),
      )
      // Second recount resolves slowly
      .mockImplementationOnce(
        () =>
          new Promise((res) =>
            setTimeout(
              () => res(makePrompt({ id: "p2", tokenCount: 20n })),
              50,
            ),
          ),
      )
      // invalidation refetch
      .mockResolvedValue([
        makePrompt({ id: "p1", tokenCount: 10n }),
        makePrompt({ id: "p2", tokenCount: 20n }),
      ] satisfies Prompt[]);

    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-tokens-view-bulk-recount"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("settings-tokens-view-bulk-recount"));

    // Button should show progress text at some point
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-tokens-view-bulk-recount").textContent,
      ).toMatch(/recounted/i);
    });
  });

  it("shows bulk error banner when a mutation fails mid-bulk", async () => {
    invokeMock
      .mockResolvedValueOnce([
        makePrompt({ id: "p1", name: "Alpha" }),
        makePrompt({ id: "p2", name: "Beta" }),
      ] satisfies Prompt[])
      .mockRejectedValueOnce(new Error("IPC failure"));

    renderWithClient(<SettingsTokensView />);
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-tokens-view-bulk-recount"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("settings-tokens-view-bulk-recount"));

    await waitFor(() => {
      expect(
        screen.getByTestId("settings-tokens-view-bulk-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/IPC failure/i)).toBeInTheDocument();
  });
});
