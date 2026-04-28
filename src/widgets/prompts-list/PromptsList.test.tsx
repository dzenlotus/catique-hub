import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Prompt } from "@entities/prompt";

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
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client };
}

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prm-1",
    name: "My Prompt",
    content: "You are a helpful assistant.",
    color: null,
    shortDescription: null,
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

describe("PromptsList", () => {
  it("renders 3 skeleton cards while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<PromptsList />);
    const skeletons = screen.getAllByTestId("prompt-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("shows the create header button always (loading state)", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<PromptsList />);
    expect(screen.getByTestId("prompts-list-create-button")).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", async () => {
    invokeMock.mockResolvedValue([] satisfies Prompt[]);
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(screen.getByTestId("prompts-list-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/нет промптов/i)).toBeInTheDocument();
  });

  it("renders one PromptCard per prompt when populated", async () => {
    invokeMock.mockResolvedValue([
      makePrompt({ id: "prm-1", name: "Summariser" }),
      makePrompt({ id: "prm-2", name: "Code Reviewer" }),
      makePrompt({ id: "prm-3", name: "Translator" }),
    ] satisfies Prompt[]);
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(screen.getByTestId("prompts-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("Summariser")).toBeInTheDocument();
    expect(screen.getByText("Code Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Translator")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    invokeMock.mockRejectedValue(new Error("db offline"));
    renderWithClient(<PromptsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/db offline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /повторить/i })).toBeInTheDocument();
  });

  it("calls onSelectPrompt with the prompt id when a card is activated", async () => {
    invokeMock.mockResolvedValue([
      makePrompt({ id: "prm-pick", name: "Pick me" }),
    ] satisfies Prompt[]);
    const onSelectPrompt = vi.fn();
    renderWithClient(<PromptsList onSelectPrompt={onSelectPrompt} />);
    await waitFor(() => {
      expect(screen.getByTestId("prompts-list-grid")).toBeInTheDocument();
    });
    screen.getByText("Pick me").click();
    expect(onSelectPrompt).toHaveBeenCalledWith("prm-pick");
  });
});
