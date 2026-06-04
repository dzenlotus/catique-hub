import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Prompt } from "@entities/prompt";
import type { PromptGroup } from "@entities/prompt-group";
import { ToastProvider } from "@shared/lib";

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
import { PromptsPage } from "../PromptsPage";

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
  it("renders the two-pane shell with the prompts sidebar + empty right pane", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("prompts-page-root")).toBeInTheDocument();
    });
    expect(screen.getByTestId("prompts-sidebar-root")).toBeInTheDocument();
    // The right pane shows the empty state when nothing is selected — the
    // sidebar is the single list (the old card grid was removed).
    await waitFor(() => {
      expect(screen.getByTestId("prompts-page-empty")).toBeInTheDocument();
    });
  });

  it("renders the canonical PROMPTS section label", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("PROMPTS")).toBeInTheDocument();
    });
  });

  it("renders one row per group in the GROUPS section", async () => {
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
        screen.getByTestId("prompts-sidebar-groups-row-grp-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-groups-row-grp-2"),
    ).toBeInTheDocument();
  });

  it("surfaces every prompt in the flat PROMPTS section, regardless of group membership", async () => {
    mockIpc({
      prompts: [makePrompt({ id: "prm-1", name: "Solo" })],
      groups: [],
    });
    renderPage();

    // Round-25 revert: no Uncategorised pseudo-group, no chevron — the
    // PROMPTS section lists every prompt flat, ungrouped prompts included.
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompts-row-prm-1"),
      ).toBeInTheDocument();
    });
  });

  it("clicking a group row opens the inline group view; prompts stay in their flat list", async () => {
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
        screen.getByTestId("prompts-sidebar-groups-row-grp-1"),
      ).toBeInTheDocument();
    });

    // Both prompts already visible in the flat PROMPTS section.
    expect(
      screen.getByTestId("prompts-sidebar-prompts-row-prm-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompts-sidebar-prompts-row-prm-2"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("prompts-sidebar-groups-row-grp-1"));

    // Right pane swaps to the inline group view.
    await waitFor(() => {
      expect(screen.getByTestId("inline-group-view")).toBeInTheDocument();
    });

    // Sidebar still surfaces both prompts in the flat list.
    expect(
      screen.getByTestId("prompts-sidebar-prompts-row-prm-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompts-sidebar-prompts-row-prm-2"),
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
        screen.getByTestId("prompts-sidebar-prompts-row-prm-x"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-prompts-row-prm-x"));

    // Editor renders inline as a panel, not as a Dialog.
    await waitFor(() => {
      expect(screen.getByTestId("prompt-editor-panel")).toBeInTheDocument();
    });
    // No <Dialog role="dialog"> should be mounted for the prompt editor.
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
        screen.getByTestId("prompts-sidebar-prompts-handle-prm-h"),
      ).toBeInTheDocument();
    });
    const handle = screen.getByTestId("prompts-sidebar-prompts-handle-prm-h");
    expect(handle).toHaveAttribute("aria-label", "Drag Drag target");
    // Handle is a <button>, so it's keyboard-reachable by default.
    expect(handle.tagName).toBe("BUTTON");
  });

  it("renders Add group + Add prompt triggers in the sidebar", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    // Round-25: each section header owns its own add trigger
    // (prefixed by the EntityTree's testIdPrefix).
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-groups-add"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-prompts-add"),
    ).toBeInTheDocument();
  });

  it("renders the tags-filter trigger in the sidebar PROMPTS section", async () => {
    mockIpc({ prompts: [], groups: [] });
    renderPage();

    // The prompts list renders (sidebar present)…
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompts-add"),
      ).toBeInTheDocument();
    });
    // …and the tag filter lives in the sidebar's PROMPTS header again as a
    // popover trigger (relocated back out of the TopBar header).
    expect(
      screen.getByTestId("prompts-sidebar-tags-filter-trigger"),
    ).toBeInTheDocument();
  });

  // The tab bar (Prompts / Groups / Tags) was removed — the sidebar is the
  // single list, and the tag library lives in the settings page. The right
  // pane just routes on the sidebar selection.
  describe("right pane", () => {
    it("renders the prompt editor panel when a prompt is selected", async () => {
      mockIpc({
        prompts: [makePrompt({ id: "prm-1", name: "Pick me" })],
        groups: [],
      });
      const { user } = renderPage();

      await user.click(
        await screen.findByTestId("prompts-sidebar-prompts-row-prm-1"),
      );
      await waitFor(() => {
        expect(screen.getByTestId("prompt-editor-panel")).toBeInTheDocument();
      });
    });

    it("renders the inline group view when a group is opened", async () => {
      mockIpc({
        prompts: [],
        groups: [makeGroup({ id: "grp-1", name: "Alpha" })],
        members: { "grp-1": [] },
      });
      const { user } = renderPage();

      await user.click(
        await screen.findByTestId("prompts-sidebar-groups-row-grp-1"),
      );
      await waitFor(() => {
        expect(screen.getByTestId("inline-group-view")).toBeInTheDocument();
      });
    });

    it("no longer renders the Prompts/Groups/Tags tab bar", async () => {
      mockIpc({ prompts: [], groups: [] });
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("prompts-page-root")).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId("prompts-page-tab-prompts"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("tablist", { name: "Prompts page mode" }),
      ).not.toBeInTheDocument();
    });
  });
});
