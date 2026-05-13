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
    icon: null,
    shortDescription: null,
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
    icon: null,
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

function clearSidebarStorage(): void {
  // Round-24 migration stores the prompt-groups expansion set under
  // `catique:sidebar:expanded:prompt-groups`. Reset between tests so
  // the previous test's toggle ordering doesn't leak into the next.
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith("catique:sidebar:expanded")) {
      localStorage.removeItem(key);
    }
  }
}

beforeEach(() => {
  invokeMock.mockReset();
  clearSidebarStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearSidebarStorage();
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

  it("renders the canonical PROMPTS section label", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("PROMPTS")).toBeInTheDocument();
    });
  });

  it("renders one EntityTree row per group at the top of the tree", async () => {
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
        screen.getByTestId("prompts-sidebar-row-group:grp-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-row-group:grp-2"),
    ).toBeInTheDocument();
  });

  it("surfaces ungrouped prompts inside the Uncategorised pseudo-group", async () => {
    mockIpc({
      prompts: [makePrompt({ id: "prm-1", name: "Solo" })],
      groups: [],
    });
    const { user } = renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-group:uncategorised"),
      ).toBeInTheDocument();
    });

    // Expand the synthetic parent — the prompt then surfaces underneath.
    await user.click(
      screen.getByTestId("prompts-sidebar-toggle-group:uncategorised"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-prompt:prm-1"),
      ).toBeInTheDocument();
    });
  });

  it("clicking a group opens the inline group view; prompts surface under their group when expanded", async () => {
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
        screen.getByTestId("prompts-sidebar-row-group:grp-1"),
      ).toBeInTheDocument();
    });

    // Expand grp-1 (member prm-1) + Uncategorised (solo prm-2).
    await user.click(screen.getByTestId("prompts-sidebar-toggle-group:grp-1"));
    await user.click(
      screen.getByTestId("prompts-sidebar-toggle-group:uncategorised"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-prompt:prm-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-row-prompt:prm-2"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("prompts-sidebar-row-group:grp-1"));

    // Right pane swaps to the inline group view.
    await waitFor(() => {
      expect(screen.getByTestId("inline-group-view")).toBeInTheDocument();
    });

    // Sidebar still surfaces both prompts (expanded state survives).
    expect(
      screen.getByTestId("prompts-sidebar-row-prompt:prm-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompts-sidebar-row-prompt:prm-2"),
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
        screen.getByTestId("prompts-sidebar-row-group:uncategorised"),
      ).toBeInTheDocument();
    });

    // Expand Uncategorised first — the ungrouped prompt nests under it.
    await user.click(
      screen.getByTestId("prompts-sidebar-toggle-group:uncategorised"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-prompt:prm-x"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-row-prompt:prm-x"));

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
    const { user } = renderPage();

    // The handle lives inside Uncategorised — expand to access it.
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-toggle-group:uncategorised"),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByTestId("prompts-sidebar-toggle-group:uncategorised"),
    );

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

    // Round-24 migration: Add prompt is the EntityTree title's add
    // trigger (`<prefix>-add`); Add group is a footer affordance.
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-add-group"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("prompts-sidebar-add")).toBeInTheDocument();
  });

  it("exposes a tags filter trigger next to the PROMPTS section label", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-tags-filter-trigger"),
      ).toBeInTheDocument();
    });
  });
});
