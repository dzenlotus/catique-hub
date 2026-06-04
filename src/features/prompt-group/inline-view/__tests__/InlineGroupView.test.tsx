import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import type { ReactElement } from "react";

import type { PromptGroup } from "@entities/prompt-group";
import type { Prompt } from "@entities/prompt";
import { ToastProvider } from "@shared/lib";

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>(
    "@shared/api",
  );
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invoke } from "@shared/api";
import { InlineGroupView } from "../InlineGroupView";

const invokeMock = vi.mocked(invoke);

function makeGroup(overrides: Partial<PromptGroup> = {}): PromptGroup {
  return {
    id: "group-1",
    name: "Test group",
    color: null,
    icon: null,
    position: 1n,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prompt-1",
    name: "Test prompt",
    content: "",
    shortDescription: null,
    color: null,
    icon: null,
    examples: [],
    tokenCount: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <DragDropProvider>{ui}</DragDropProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InlineGroupView — OriginBadge 'via group'", () => {
  it("renders a group-origin badge next to each member", async () => {
    const prompts = [
      makePrompt({ id: "pid-A", name: "Alpha" }),
      makePrompt({ id: "pid-B", name: "Beta" }),
    ];
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return makeGroup();
      if (cmd === "list_prompt_group_members") return ["pid-A", "pid-B"];
      if (cmd === "list_prompts") return prompts;
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithProviders(
      <InlineGroupView
        groupId="group-1"
        onSelectPrompt={() => {}}
        onGroupSettings={() => {}}
        onDeleteGroup={() => {}}
      />,
    );

    // Card cells must mount before we assert on the badges nested inside.
    await waitFor(() => {
      expect(
        screen.getByTestId("inline-group-view-card-pid-A"),
      ).toBeInTheDocument();
    });

    const badgeA = screen.getByTestId("inline-group-view-origin-pid-A");
    const badgeB = screen.getByTestId("inline-group-view-origin-pid-B");

    // Visible label per design — "via group".
    expect(badgeA).toHaveTextContent("via group");
    expect(badgeB).toHaveTextContent("via group");

    // CSS module's tint hook + a11y disambiguation.
    expect(badgeA).toHaveAttribute("data-origin", "group");
    expect(badgeA).toHaveAttribute("aria-label", "Member of prompt group");
  });

  it("renders no group badge when the membership list is empty", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return makeGroup();
      if (cmd === "list_prompt_group_members") return [];
      if (cmd === "list_prompts") return [];
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithProviders(
      <InlineGroupView
        groupId="group-1"
        onSelectPrompt={() => {}}
        onGroupSettings={() => {}}
        onDeleteGroup={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("inline-group-view")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(/^inline-group-view-origin-/),
    ).not.toBeInTheDocument();
  });
});
