/**
 * PromptsSidebar — tests for the flat-IA rail (round-25 revert).
 *
 * Covers:
 *   - Two flat EntityTree sections (GROUPS + PROMPTS) inside one shell.
 *   - "All Prompts" header entry above both sections.
 *   - Selection / kebab actions / header affordances.
 *   - DnD DOM contract (drag handles + drop targets emit the canonical
 *     testids `PromptsPage`'s drag-end handler routes to).
 *   - Loading + error states for each section independently.
 *
 * Pointer-event drag flows aren't exercised — jsdom can't drive them.
 * IPC-level reorder/add-to-group is owned by `PromptsPage` tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import type { ReactElement } from "react";
import { TestRouter } from "@shared/lib";

import { ToastProvider } from "@app/providers/ToastProvider";
import { PromptsSidebar } from "../PromptsSidebar";

// ---------------------------------------------------------------------------
// Mock the Tauri invoke wrapper so entity hooks resolve from stubs.
// ---------------------------------------------------------------------------
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

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Stub data — two groups, three prompts (one unassigned).
// ---------------------------------------------------------------------------

const STUB_GROUPS = [
  {
    id: "grp-1",
    name: "Inbox",
    description: null,
    icon: null,
    color: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "grp-2",
    name: "Archive",
    description: null,
    icon: null,
    color: null,
    position: 2,
    createdAt: 0n,
    updatedAt: 0n,
  },
];

const STUB_PROMPTS = [
  {
    id: "prm-1",
    name: "Brainstorm",
    description: null,
    body: "",
    icon: null,
    color: null,
    tokenCount: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "prm-2",
    name: "Summary",
    description: null,
    body: "",
    icon: null,
    color: null,
    tokenCount: null,
    position: 2,
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "prm-3",
    name: "Loose end",
    description: null,
    body: "",
    icon: null,
    color: null,
    tokenCount: null,
    position: 3,
    createdAt: 0n,
    updatedAt: 0n,
  },
];

const STUB_GROUP_MEMBERS = {
  "grp-1": ["prm-1"],
  "grp-2": ["prm-2"],
};

// ---------------------------------------------------------------------------
// Render helper — wires react-query, wouter router, toast provider, and
// a DnD provider (so `useDroppable` / `useSortable` have context).
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

interface SetupOptions {
  selectedPromptId?: string | null;
  selectedGroupId?: string | null;
  onSelectGroup?: (id: string | null) => void;
  onSelectPrompt?: (id: string) => void;
  onRenameGroup?: (id: string) => void;
  onGroupSettings?: (id: string) => void;
  onDeleteGroup?: (id: string) => void;
  onOpenSettings?: () => void;
}

function setup(options: SetupOptions = {}): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const user = userEvent.setup();
  const ui: ReactElement = (
    <TestRouter path="/">
      <QueryClientProvider client={makeQueryClient()}>
        <ToastProvider>
          <DragDropProvider>
            <PromptsSidebar
              selectedPromptId={options.selectedPromptId ?? null}
              selectedGroupId={options.selectedGroupId ?? null}
              onSelectGroup={options.onSelectGroup ?? vi.fn()}
              onSelectPrompt={options.onSelectPrompt ?? vi.fn()}
              onRenameGroup={options.onRenameGroup ?? vi.fn()}
              onGroupSettings={options.onGroupSettings ?? vi.fn()}
              onDeleteGroup={options.onDeleteGroup ?? vi.fn()}
              onOpenSettings={options.onOpenSettings ?? vi.fn()}
              groupMembers={STUB_GROUP_MEMBERS}
            />
          </DragDropProvider>
        </ToastProvider>
      </QueryClientProvider>
    </TestRouter>
  );
  render(ui);
  return { user };
}

function mockHappyPath(): void {
  invokeMock.mockImplementation((cmd: unknown) => {
    if (cmd === "list_prompts") return Promise.resolve(STUB_PROMPTS);
    if (cmd === "list_prompt_groups") return Promise.resolve(STUB_GROUPS);
    if (cmd === "list_prompt_tags_map") return Promise.resolve([]);
    if (cmd === "list_tags") return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Composition / chrome
// ---------------------------------------------------------------------------

describe("PromptsSidebar — composition", () => {
  it("renders both GROUPS and PROMPTS section labels", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(screen.getByText(/^GROUPS$/)).toBeInTheDocument();
    });
    expect(screen.getByText(/^PROMPTS$/)).toBeInTheDocument();
  });

  it("renders the All Prompts header entry above both sections", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-all-prompts"),
      ).toBeInTheDocument();
    });
  });

  it("renders one row per group in the GROUPS section", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-groups-row-grp-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-groups-row-grp-2"),
    ).toBeInTheDocument();
  });

  it("renders one row per prompt in the PROMPTS section (flat, not nested under any group)", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompts-row-prm-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-prompts-row-prm-2"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompts-sidebar-prompts-row-prm-3"),
    ).toBeInTheDocument();
  });

  it("renders the loading body while either query is pending", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    setup();
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0);
  });

  it("renders an error message when the prompts query fails", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_prompts") return Promise.reject(new Error("boom"));
      if (cmd === "list_prompt_groups") return Promise.resolve(STUB_GROUPS);
      return Promise.resolve([]);
    });
    setup();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /failed to load prompts/i,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("PromptsSidebar — selection", () => {
  it("clicking a prompt row fires onSelectPrompt with the bare prompt id", async () => {
    mockHappyPath();
    const onSelectPrompt = vi.fn();
    const { user } = setup({ onSelectPrompt });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompts-row-prm-1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-prompts-row-prm-1"));

    expect(onSelectPrompt).toHaveBeenCalledWith("prm-1");
  });

  it("clicking a group row fires onSelectGroup with that group id", async () => {
    mockHappyPath();
    const onSelectGroup = vi.fn();
    const { user } = setup({ onSelectGroup });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-groups-row-grp-1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-groups-row-grp-1"));

    expect(onSelectGroup).toHaveBeenCalledWith("grp-1");
  });

  it("clicking All Prompts fires onSelectGroup with null", async () => {
    mockHappyPath();
    const onSelectGroup = vi.fn();
    const { user } = setup({ onSelectGroup });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-all-prompts"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-all-prompts"));

    expect(onSelectGroup).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Group kebab menu
// ---------------------------------------------------------------------------

describe("PromptsSidebar — group kebab actions", () => {
  it("fires onRenameGroup when the Rename menu item is picked", async () => {
    mockHappyPath();
    const onRenameGroup = vi.fn();
    const { user } = setup({ onRenameGroup });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-group-kebab-grp-1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-group-kebab-grp-1"));
    const renameItem = await screen.findByRole("menuitem", { name: /rename/i });
    await user.click(renameItem);

    expect(onRenameGroup).toHaveBeenCalledWith("grp-1");
  });

  it("fires onDeleteGroup when the Delete menu item is picked", async () => {
    mockHappyPath();
    const onDeleteGroup = vi.fn();
    const { user } = setup({ onDeleteGroup });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-group-kebab-grp-1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-group-kebab-grp-1"));
    const deleteItem = await screen.findByRole("menuitem", { name: /delete/i });
    await user.click(deleteItem);

    expect(onDeleteGroup).toHaveBeenCalledWith("grp-1");
  });
});

// ---------------------------------------------------------------------------
// Header affordances — TagsFilter + Settings + Add triggers
// ---------------------------------------------------------------------------

describe("PromptsSidebar — header affordances", () => {
  it("renders the tag-filter trigger in the PROMPTS title trailing slot", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-tags-filter-trigger"),
      ).toBeInTheDocument();
    });
  });

  it("renders the settings cog in the PROMPTS title trailing slot", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-settings-trigger"),
      ).toBeInTheDocument();
    });
  });

  it("clicking the settings cog fires onOpenSettings", async () => {
    mockHappyPath();
    const onOpenSettings = vi.fn();
    const { user } = setup({ onOpenSettings });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-settings-trigger"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("prompts-sidebar-settings-trigger"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("exposes the Add-prompt trigger on the PROMPTS section header", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompts-add"),
      ).toBeInTheDocument();
    });
  });

  it("exposes the Add-group trigger on the GROUPS section header", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-groups-add"),
      ).toBeInTheDocument();
    });
  });

  it("clicking Add prompt opens the prompt-create dialog", async () => {
    mockHappyPath();
    const { user } = setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompts-add"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-prompts-add"));

    await waitFor(() => {
      expect(screen.getByTestId("prompt-create-dialog")).toBeInTheDocument();
    });
  });

  it("clicking Add group opens the group-create dialog", async () => {
    mockHappyPath();
    const { user } = setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-groups-add"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-groups-add"));

    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-group-create-dialog"),
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// DnD DOM contract — handles + droppables emit the canonical testids
// PromptsPage's drag-end handler routes to.
// ---------------------------------------------------------------------------

describe("PromptsSidebar — DnD wiring (DOM contract)", () => {
  it("exposes a drag handle for every prompt row", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompts-handle-prm-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-prompts-handle-prm-2"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompts-sidebar-prompts-handle-prm-3"),
    ).toBeInTheDocument();
  });

  it("exposes a droppable container for every group row", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-groups-droppable-grp-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-groups-droppable-grp-2"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Active-row mapping
// ---------------------------------------------------------------------------

describe("PromptsSidebar — selected highlight mapping", () => {
  it("marks All Prompts as active when nothing is selected", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-all-prompts"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-all-prompts"),
    ).toHaveAttribute("aria-current", "page");
  });

  it("does NOT mark All Prompts as active when a group is selected", async () => {
    mockHappyPath();
    setup({ selectedGroupId: "grp-1" });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-all-prompts"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-all-prompts").getAttribute("aria-current"),
    ).not.toBe("page");
  });
});
