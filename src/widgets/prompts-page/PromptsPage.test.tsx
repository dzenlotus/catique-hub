import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Prompt } from "@entities/prompt";
import type { PromptGroup } from "@entities/prompt-group";
import { ToastProvider } from "@app/providers/ToastProvider";

// Mock the Tauri invoke wrapper at the shared/api boundary so the page's
// fan-out queries (prompts, groups, per-group members) all run against
// fixtures.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { PromptsPage } from "./PromptsPage";

const invokeMock = vi.mocked(invoke);

function renderPage(): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PromptsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { user };
}

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prm-1",
    name: "Prompt 1",
    content: "...",
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

function makeGroup(overrides: Partial<PromptGroup> = {}): PromptGroup {
  return {
    id: "grp-1",
    name: "Group 1",
    color: null,
    position: 0n,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

interface IpcFixture {
  prompts: Prompt[];
  groups: PromptGroup[];
  /** groupId → ordered prompt id list. */
  members?: Record<string, string[]>;
}

function mockIpc({ prompts, groups, members = {} }: IpcFixture): void {
  invokeMock.mockImplementation((command: string, args?: unknown) => {
    if (command === "list_prompts") return Promise.resolve(prompts);
    if (command === "list_prompt_groups") return Promise.resolve(groups);
    if (command === "list_prompt_tags_map") return Promise.resolve([]);
    if (command === "list_tags") return Promise.resolve([]);
    if (command === "list_prompt_group_members") {
      const groupId = (args as { groupId: string } | undefined)?.groupId;
      return Promise.resolve(groupId ? (members[groupId] ?? []) : []);
    }
    // All other commands hang silently (avoids masking unintended IPC).
    return new Promise(() => {});
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PromptsPage", () => {
  it("renders the two-pane shell with the prompts sidebar + grid", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("prompts-page-root")).toBeInTheDocument();
    });
    expect(screen.getByTestId("prompts-sidebar-root")).toBeInTheDocument();
    // The PromptsList grid eventually settles into the empty state once
    // the prompts query resolves.
    await waitFor(() => {
      expect(screen.getByTestId("prompts-list-empty")).toBeInTheDocument();
    });
  });

  it("shows GROUPS + PROMPTS section labels in the sidebar", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("GROUPS")).toBeInTheDocument();
    });
    // Round-19d: bottom section header is always just "PROMPTS" — the
    // active group no longer filters the sidebar list.
    expect(screen.getByText("PROMPTS")).toBeInTheDocument();
  });

  it("lists groups in the top section", async () => {
    mockIpc({
      prompts: [],
      groups: [
        makeGroup({ id: "grp-1", name: "Alpha" }),
        makeGroup({ id: "grp-2", name: "Beta" }),
      ],
    });
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-group-row-grp-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-group-row-grp-2"),
    ).toBeInTheDocument();
  });

  it("lists ungrouped prompts in the bottom section by default", async () => {
    mockIpc({
      prompts: [makePrompt({ id: "prm-1", name: "Solo" })],
      groups: [],
    });
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompt-row-prm-1"),
      ).toBeInTheDocument();
    });
  });

  it("clicking a group opens the inline group view and keeps all prompts in the sidebar", async () => {
    mockIpc({
      prompts: [
        makePrompt({ id: "prm-1", name: "Member" }),
        makePrompt({ id: "prm-2", name: "Solo" }),
      ],
      groups: [makeGroup({ id: "grp-1", name: "Alpha" })],
      members: { "grp-1": ["prm-1"] },
    });
    const { user } = renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-group-select-grp-1"),
      ).toBeInTheDocument();
    });
    // Both prompts are visible in the sidebar regardless of group state.
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompt-row-prm-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-prompt-row-prm-2"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByTestId("prompts-sidebar-group-select-grp-1"),
    );

    // Right pane swaps to the inline group view.
    await waitFor(() => {
      expect(screen.getByTestId("inline-group-view")).toBeInTheDocument();
    });

    // Sidebar still shows BOTH prompts.
    expect(
      screen.getByTestId("prompts-sidebar-prompt-row-prm-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompts-sidebar-prompt-row-prm-2"),
    ).toBeInTheDocument();
  });

  it("clicking a prompt row opens the inline editor panel (not a modal)", async () => {
    mockIpc({
      prompts: [makePrompt({ id: "prm-x", name: "Open me" })],
      groups: [],
    });
    const { user } = renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompt-select-prm-x"),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByTestId("prompts-sidebar-prompt-select-prm-x"),
    );

    // Round-19d: editor renders inline as a panel, not as a Dialog.
    await waitFor(() => {
      expect(screen.getByTestId("prompt-editor-panel")).toBeInTheDocument();
    });
    // No <Dialog role="dialog"> should be mounted for the prompt editor
    // (modals from other widgets — eg. group create — are NOT triggered
    // by this click path, so role=dialog should be entirely absent).
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exposes a draggable handle with an aria-label per prompt row", async () => {
    mockIpc({
      prompts: [makePrompt({ id: "prm-h", name: "Drag target" })],
      groups: [],
    });
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompt-handle-prm-h"),
      ).toBeInTheDocument();
    });
    const handle = screen.getByTestId("prompts-sidebar-prompt-handle-prm-h");
    expect(handle).toHaveAttribute("aria-label", "Drag prompt Drag target");
    // Handle is a <button>, so it's keyboard-reachable by default.
    expect(handle.tagName).toBe("BUTTON");
  });

  it("renders Add group + Add prompt triggers in the sidebar", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-add-group"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-add-prompt"),
    ).toBeInTheDocument();
  });
});
