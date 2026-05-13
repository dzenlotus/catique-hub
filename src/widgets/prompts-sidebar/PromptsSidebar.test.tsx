/**
 * PromptsSidebar — tests for the EntityTree-backed rail.
 *
 * Round-24 migration: the rail consumes `<EntityTree>` with namespaced
 * row ids (`group:<id>` / `prompt:<id>`). These tests cover the load
 * paths, the kebab actions, the persisted expansion state, and that
 * the rail emits the canonical `prompts-sidebar-row-...` testids that
 * every other entity rail emits.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { ToastProvider } from "@app/providers/ToastProvider";
import { PromptsSidebar } from "./PromptsSidebar";

// ---------------------------------------------------------------------------
// Mock the Tauri invoke wrapper so the entity hooks resolve from stubs.
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
// Stub data — two groups with one prompt each, plus one uncategorised.
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

// `groupMembers` is the contract from PromptsPage. Two groups, each
// owns one prompt; `prm-3` is unassigned ⇒ lands in Uncategorised.
const STUB_GROUP_MEMBERS = {
  "grp-1": ["prm-1"],
  "grp-2": ["prm-2"],
};

// ---------------------------------------------------------------------------
// Render helper — wires everything PromptsSidebar needs at runtime:
// react-query, wouter router (TagsFilterButton uses no router but the
// providers used elsewhere assume one), toast provider (used by callers),
// and a DnD provider so `useDroppable` / `useSortable` have context.
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
  const { hook } = memoryLocation({ path: "/", static: true });
  const ui: ReactElement = (
    <Router hook={hook}>
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
    </Router>
  );
  render(ui);
  return { user };
}

function clearExpandedFlags(): void {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith("catique:sidebar:expanded")) {
      localStorage.removeItem(key);
    }
  }
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
  clearExpandedFlags();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearExpandedFlags();
});

// ---------------------------------------------------------------------------
// Composition / chrome
// ---------------------------------------------------------------------------

describe("PromptsSidebar — EntityTree composition", () => {
  it("renders the EntityTree-shaped row testids once data lands", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-group:grp-1"),
      ).toBeInTheDocument();
    });
    // Both groups visible at the top level.
    expect(
      screen.getByTestId("prompts-sidebar-row-group:grp-2"),
    ).toBeInTheDocument();
    // Uncategorised pseudo-group covers prm-3.
    expect(
      screen.getByTestId("prompts-sidebar-row-group:uncategorised"),
    ).toBeInTheDocument();
  });

  it("renders the All Prompts header entry above the tree", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-all-prompts"),
      ).toBeInTheDocument();
    });
  });

  it("emits the canonical PROMPTS section label", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(screen.getByText(/^PROMPTS$/)).toBeInTheDocument();
    });
  });

  it("renders the loading body while either query is pending", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    setup();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
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
// Expansion / selection
// ---------------------------------------------------------------------------

describe("PromptsSidebar — expansion + selection", () => {
  it("hides group children until the chevron is toggled", async () => {
    mockHappyPath();
    const { user } = setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-group:grp-1"),
      ).toBeInTheDocument();
    });

    // grp-1's child prompt (prm-1) is not in the DOM while collapsed.
    expect(
      screen.queryByTestId("prompts-sidebar-row-prompt:prm-1"),
    ).not.toBeInTheDocument();

    const toggle = screen.getByTestId("prompts-sidebar-toggle-group:grp-1");
    await user.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-prompt:prm-1"),
      ).toBeInTheDocument();
    });
  });

  it("clicking a prompt row fires onSelectPrompt with the bare prompt id", async () => {
    mockHappyPath();
    const onSelectPrompt = vi.fn();
    const { user } = setup({ onSelectPrompt });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-group:grp-1"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("prompts-sidebar-toggle-group:grp-1"));
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-prompt:prm-1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-row-prompt:prm-1"));

    expect(onSelectPrompt).toHaveBeenCalledWith("prm-1");
  });

  it("clicking a real group row fires onSelectGroup with that group id", async () => {
    mockHappyPath();
    const onSelectGroup = vi.fn();
    const { user } = setup({ onSelectGroup });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-group:grp-1"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-row-group:grp-1"));

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

  it("persists expanded group ids under the migration-compatible storage key", async () => {
    mockHappyPath();
    const { user } = setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-toggle-group:grp-1"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("prompts-sidebar-toggle-group:grp-1"));
    await waitFor(() => {
      const stored = localStorage.getItem(
        "catique:sidebar:expanded:prompt-groups",
      );
      // JSON array containing the namespaced group node id.
      expect(stored).toContain("group:grp-1");
    });
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
    // Menu items render inside an aria-owned listbox/portal — querying by
    // role is the stable handle here.
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

  it("the Uncategorised pseudo-group has NO kebab affordance", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-group:uncategorised"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("prompts-sidebar-group-kebab-uncategorised"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Header affordances — TagsFilter + Settings + Add buttons
// ---------------------------------------------------------------------------

describe("PromptsSidebar — header affordances", () => {
  it("renders the tag-filter trigger in the title trailing slot", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-tags-filter-trigger"),
      ).toBeInTheDocument();
    });
  });

  it("renders the settings cog in the title trailing slot", async () => {
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

  it("renders the Add prompt trigger once the queries succeed", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-add"),
      ).toBeInTheDocument();
    });
  });

  it("renders the Add group trigger as a footer affordance", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-add-group"),
      ).toBeInTheDocument();
    });
  });

  it("clicking Add prompt opens the prompt-create dialog", async () => {
    mockHappyPath();
    const { user } = setup();
    await waitFor(() => {
      expect(screen.getByTestId("prompts-sidebar-add")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-add"));

    await waitFor(() => {
      expect(screen.getByTestId("prompt-create-dialog")).toBeInTheDocument();
    });
  });

  it("clicking Add group opens the group-create dialog", async () => {
    mockHappyPath();
    const { user } = setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-add-group"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prompts-sidebar-add-group"));

    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-group-create-dialog"),
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Drag handles + drop targets — DOM contract only (jsdom cannot drive
// real pointer-event drag flows). The IPC-level behaviour is owned by
// PromptsPage and exercised in its own test surface.
// ---------------------------------------------------------------------------

describe("PromptsSidebar — DnD wiring (DOM contract)", () => {
  it("exposes a drag handle for every prompt row", async () => {
    mockHappyPath();
    const { user } = setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-toggle-group:grp-1"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("prompts-sidebar-toggle-group:grp-1"));
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-prompt-handle-prm-1"),
      ).toBeInTheDocument();
    });
  });

  it("exposes a droppable container for every real group row", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-group-droppable-grp-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("prompts-sidebar-group-droppable-grp-2"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Active-row mapping
// ---------------------------------------------------------------------------

describe("PromptsSidebar — selected highlight mapping", () => {
  it("does NOT mark All Prompts as active when a group is selected", async () => {
    mockHappyPath();
    setup({ selectedGroupId: "grp-1" });
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-all-prompts"),
      ).toBeInTheDocument();
    });
    const allPrompts = screen.getByTestId("prompts-sidebar-all-prompts");
    expect(allPrompts.getAttribute("aria-current")).not.toBe("page");
  });

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

  it("does not render the prompt row at the top level (it lives inside its group)", async () => {
    mockHappyPath();
    setup();
    await waitFor(() => {
      expect(
        screen.getByTestId("prompts-sidebar-row-group:grp-1"),
      ).toBeInTheDocument();
    });
    // The group's children container only mounts once expanded — and
    // before expansion `prm-1` is not in the DOM at all.
    const groupItem = screen.getByTestId("prompts-sidebar-item-group:grp-1");
    expect(
      within(groupItem).queryByTestId("prompts-sidebar-row-prompt:prm-1"),
    ).not.toBeInTheDocument();
  });
});
