import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { Sidebar } from "./Sidebar";
import type { NavView } from "./Sidebar";

// ---------------------------------------------------------------------------
// Mock the Tauri invoke wrapper so we can control what useSpaces() returns.
// ---------------------------------------------------------------------------
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderWithClient(
  ui: ReactElement,
  client = makeQueryClient(),
  initialPath = "/",
): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  const { hook } = memoryLocation({ path: initialPath, static: true });
  render(
    <Router hook={hook}>
      <QueryClientProvider client={client}>
        <ActiveSpaceProvider>{ui}</ActiveSpaceProvider>
      </QueryClientProvider>
    </Router>,
  );
  return { user };
}

/**
 * Round 4 NavView list — 7 workspace items.
 * "roles" → "agent-roles", "mcp-tools" → "mcp-servers".
 * "tags", "reports" removed from sidebar nav.
 */
const ALL_VIEWS: NavView[] = [
  "boards",
  "agent-roles",
  "prompts",
  "prompt-groups",
  "skills",
  "mcp-servers",
  "settings",
];

function setup(
  activeView: NavView = "boards",
  onSelectView = vi.fn(),
): { user: ReturnType<typeof userEvent.setup> } {
  return renderWithClient(
    <Sidebar activeView={activeView} onSelectView={onSelectView} />,
  );
}

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------

const STUB_SPACES = [
  {
    id: "spc-1",
    name: "Alpha",
    prefix: "alp",
    description: null,
    isDefault: true,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "spc-2",
    name: "Beta",
    prefix: "bet",
    description: "Beta space",
    isDefault: false,
    position: 2,
    createdAt: 0n,
    updatedAt: 0n,
  },
];

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.removeItem("catique:activeSpaceId");
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("catique:activeSpaceId");
});

// ---------------------------------------------------------------------------
// DS v1 — Wordmark + section labels
// ---------------------------------------------------------------------------

describe("Sidebar — DS v1 wordmark and section labels", () => {
  beforeEach(() => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
  });

  it("renders the wordmark 'Catique Hub'", () => {
    setup();
    expect(screen.getByText("Catique Hub")).toBeInTheDocument();
  });

  it("renders the SPACES section label", () => {
    setup();
    expect(screen.getByText(/^SPACES$/)).toBeInTheDocument();
  });

  it("renders the WORKSPACE section label", () => {
    setup();
    // Per image5.png the WORKSPACE label is present.
    expect(screen.getByText(/^WORKSPACE$/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DS v1 — RECENT BOARDS section
// ---------------------------------------------------------------------------

const STUB_BOARDS = [
  {
    id: "brd-1",
    name: "Engineering",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 100n,
  },
  {
    id: "brd-2",
    name: "Roadmap",
    spaceId: "spc-1",
    roleId: null,
    position: 2,
    createdAt: 0n,
    updatedAt: 200n,
  },
];

describe("Sidebar — DS v1 RECENT BOARDS section", () => {
  it("renders the RECENT BOARDS section label when boards are loaded", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve(STUB_BOARDS);
      return Promise.resolve([]);
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText(/^RECENT BOARDS$/)).toBeInTheDocument();
    });
  });

  it("renders board names in the RECENT BOARDS section", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve(STUB_BOARDS);
      return Promise.resolve([]);
    });
    setup();
    await waitFor(() => {
      // Board names appear in SPACES section (inline) and RECENT BOARDS.
      // At least one instance of "Engineering" should be present.
      expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Roadmap").length).toBeGreaterThan(0);
  });

  it("does not render RECENT BOARDS section when boards list is empty", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    setup();
    // Give the queries time to settle
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.queryByText(/^RECENT BOARDS$/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Nav items — Round 4 workspace items
// ---------------------------------------------------------------------------

describe("Sidebar — nav items (Round 4)", () => {
  beforeEach(() => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
  });

  it("renders all 7 workspace nav items", () => {
    setup();
    expect(screen.getByRole("button", { name: /^boards$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /agent roles/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^prompts$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prompt groups/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^skills$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mcp servers/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^settings$/i })).toBeInTheDocument();
  });

  it("renders with a <nav> labelled 'Main navigation'", () => {
    setup();
    expect(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
  });

  it.each(ALL_VIEWS)(
    "marks the active item with aria-current='page' — view: %s",
    (view) => {
      setup(view);
      // Map view to the expected label for querying
      const labelMap: Record<NavView, RegExp> = {
        boards: /^boards$/i,
        "agent-roles": /agent roles/i,
        prompts: /^prompts$/i,
        "prompt-groups": /prompt groups/i,
        skills: /^skills$/i,
        "mcp-servers": /mcp servers/i,
        settings: /^settings$/i,
        spaces: /spaces/i,
      };
      const activeButton = screen.getByRole("button", { name: labelMap[view] });
      expect(activeButton).toHaveAttribute("aria-current", "page");
    },
  );

  it("does not set aria-current on inactive items", () => {
    setup("boards");
    // All items except boards should not have aria-current
    const inactiveRegexes = [
      /agent roles/i,
      /^prompts$/i,
      /prompt groups/i,
      /^skills$/i,
      /mcp servers/i,
    ];
    for (const regex of inactiveRegexes) {
      const btn = screen.getByRole("button", { name: regex });
      expect(btn).not.toHaveAttribute("aria-current");
    }
  });

  it("calls onSelectView with the clicked view", async () => {
    const onSelectView = vi.fn();
    const { user } = setup("boards", onSelectView);

    await user.click(screen.getByRole("button", { name: /^prompts$/i }));
    expect(onSelectView).toHaveBeenCalledWith("prompts");
    expect(onSelectView).toHaveBeenCalledTimes(1);
  });

  it("calls onSelectView for each nav item when clicked", async () => {
    const onSelectView = vi.fn();
    const { user } = setup("boards", onSelectView);

    const itemsToClick: Array<[NavView, RegExp]> = [
      ["boards", /^boards$/i],
      ["agent-roles", /agent roles/i],
      ["prompts", /^prompts$/i],
      ["prompt-groups", /prompt groups/i],
      ["skills", /^skills$/i],
      ["mcp-servers", /mcp servers/i],
      ["settings", /^settings$/i],
    ];

    for (const [, regex] of itemsToClick) {
      await user.click(screen.getByRole("button", { name: regex }));
    }
    expect(onSelectView).toHaveBeenCalledTimes(itemsToClick.length);
    itemsToClick.forEach(([view], i) => {
      expect(onSelectView).toHaveBeenNthCalledWith(i + 1, view);
    });
  });

  it("renders Settings nav item", () => {
    setup();
    expect(screen.getByRole("button", { name: /^settings$/i })).toBeInTheDocument();
  });

  it("marks Settings as active when activeView is 'settings'", () => {
    setup("settings");
    const btn = screen.getByRole("button", { name: /^settings$/i });
    expect(btn).toHaveAttribute("aria-current", "page");
  });

  it("does not mark Settings as active when activeView is 'boards'", () => {
    setup("boards");
    const btn = screen.getByRole("button", { name: /^settings$/i });
    expect(btn).not.toHaveAttribute("aria-current");
  });

  it("calls onSelectView with 'settings' when clicked", async () => {
    const onSelectView = vi.fn();
    const { user } = setup("boards", onSelectView);
    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(onSelectView).toHaveBeenCalledWith("settings");
  });
});

// ---------------------------------------------------------------------------
// SPACES section — inline collapsible space rows
// ---------------------------------------------------------------------------

describe("Sidebar — SPACES section (inline collapsible)", () => {
  it("shows a skeleton while spaces are loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    setup();
    // aria-hidden skeleton container
    const skeleton = document.querySelector("[aria-hidden='true']");
    expect(skeleton).toBeInTheDocument();
  });

  it("renders the active space name after load", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
  });

  it("renders an error indicator when useSpaces fails", async () => {
    invokeMock.mockRejectedValue(new Error("network error"));
    setup();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/spaces unavailable/i)).toBeInTheDocument();
    // The nav items are still rendered — error does not crash the sidebar.
    expect(screen.getByRole("button", { name: /^boards$/i })).toBeInTheDocument();
  });

  it("shows empty state when spaces list is empty", async () => {
    invokeMock.mockResolvedValue([]);
    setup();
    await waitFor(() => {
      // Nav items still render normally.
      expect(screen.getByRole("button", { name: /^boards$/i })).toBeInTheDocument();
    });
  });

  it("restores activeSpaceId from localStorage on mount", async () => {
    localStorage.setItem("catique:activeSpaceId", "spc-2");
    invokeMock.mockResolvedValue(STUB_SPACES);
    setup();
    await waitFor(() => {
      expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    });
  });

  it("expand chevron button has aria-expanded attribute", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    // Chevron buttons exist and have aria-expanded
    const chevrons = screen.getAllByRole("button", { name: /развернуть|свернуть/i });
    expect(chevrons.length).toBeGreaterThan(0);
    const first = chevrons[0];
    expect(first).toHaveAttribute("aria-expanded");
  });

  it("clicking chevron toggles aria-expanded", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
      if (cmd === "list_boards") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const { user } = setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    // First space (Alpha) starts expanded (isDefault + index 0)
    const chevrons = screen.getAllByRole("button", { name: /развернуть|свернуть/i });
    const alphaChevron = chevrons[0];
    const initialExpanded = alphaChevron.getAttribute("aria-expanded");

    await user.click(alphaChevron);

    await waitFor(() => {
      const newExpanded = alphaChevron.getAttribute("aria-expanded");
      expect(newExpanded).not.toBe(initialExpanded);
    });
  });
});

// ---------------------------------------------------------------------------
// ThemeToggle tests
// ---------------------------------------------------------------------------

describe("Sidebar — ThemeToggle", () => {
  beforeEach(() => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    delete document.documentElement.dataset["theme"];
    localStorage.removeItem("catique:theme");
  });

  afterEach(() => {
    delete document.documentElement.dataset["theme"];
    localStorage.removeItem("catique:theme");
  });

  it("renders the theme toggle button", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /тема/i }),
    ).toBeInTheDocument();
  });

  it("clicking the toggle flips data-theme on document.documentElement", async () => {
    const { user } = setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });

    await user.click(toggleBtn);
    expect(document.documentElement.dataset["theme"]).toBe("light");

    await user.click(toggleBtn);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });

  it("toggle has aria-pressed attribute", () => {
    setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });
    expect(toggleBtn).toHaveAttribute("aria-pressed");
  });

  it("toggle has aria-label", () => {
    setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });
    expect(toggleBtn).toHaveAttribute("aria-label");
  });

  it("correctly initialises from existing data-theme='light'", () => {
    document.documentElement.dataset["theme"] = "light";
    setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });
    expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("persists the new theme to localStorage after toggling", async () => {
    const { user } = setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });

    await user.click(toggleBtn);
    expect(localStorage.getItem("catique:theme")).toBe("light");

    await user.click(toggleBtn);
    expect(localStorage.getItem("catique:theme")).toBe("dark");
  });

  it("reads persisted 'light' from localStorage via data-theme on init", () => {
    document.documentElement.dataset["theme"] = "light";
    localStorage.setItem("catique:theme", "light");
    setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });
    expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
  });
});
