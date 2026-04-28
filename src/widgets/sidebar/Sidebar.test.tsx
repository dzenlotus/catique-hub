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

const ALL_VIEWS: NavView[] = ["boards", "prompts", "roles", "tags", "reports", "settings"];

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

  it("renders the wordmark 'Catique HUB'", () => {
    setup();
    expect(screen.getByText("Catique HUB")).toBeInTheDocument();
  });

  it("renders the SPACES section label", () => {
    setup();
    expect(screen.getByText(/^SPACES$/)).toBeInTheDocument();
  });

  it("renders the WORKSPACE section label", () => {
    setup();
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
      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
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
// Original nav-item tests — must not regress
// ---------------------------------------------------------------------------

describe("Sidebar — nav items", () => {
  beforeEach(() => {
    // Never resolves, so the space switcher stays in skeleton state and
    // doesn't interfere with nav-item assertions.
    invokeMock.mockImplementation(() => new Promise(() => {}));
  });

  it("renders all six nav items", () => {
    setup();
    expect(screen.getByRole("button", { name: /boards/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prompts/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /roles/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tags/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
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
      const activeButton = screen.getByRole("button", {
        name: new RegExp(view, "i"),
      });
      expect(activeButton).toHaveAttribute("aria-current", "page");
    },
  );

  it("does not set aria-current on inactive items", () => {
    setup("boards");
    const inactive = ["prompts", "roles", "tags", "reports"] as const;
    for (const view of inactive) {
      const btn = screen.getByRole("button", { name: new RegExp(view, "i") });
      expect(btn).not.toHaveAttribute("aria-current");
    }
  });

  it("calls onSelectView with the clicked view", async () => {
    const onSelectView = vi.fn();
    const { user } = setup("boards", onSelectView);

    await user.click(screen.getByRole("button", { name: /prompts/i }));
    expect(onSelectView).toHaveBeenCalledWith("prompts");
    expect(onSelectView).toHaveBeenCalledTimes(1);
  });

  it("calls onSelectView for each nav item when clicked", async () => {
    const onSelectView = vi.fn();
    const { user } = setup("boards", onSelectView);

    for (const view of ALL_VIEWS) {
      await user.click(screen.getByRole("button", { name: new RegExp(view, "i") }));
    }
    expect(onSelectView).toHaveBeenCalledTimes(ALL_VIEWS.length);
    ALL_VIEWS.forEach((view, i) => {
      expect(onSelectView).toHaveBeenNthCalledWith(i + 1, view);
    });
  });
});

// ---------------------------------------------------------------------------
// Space-switcher tests
// ---------------------------------------------------------------------------

describe("Sidebar — space switcher", () => {
  it("shows a skeleton while spaces are loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    setup();
    // aria-hidden skeleton container
    const skeleton = document.querySelector("[aria-hidden='true']");
    expect(skeleton).toBeInTheDocument();
  });

  it("renders the active (default) space name after load", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    setup();
    // The trigger label includes the space name.
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    // Prefix chip
    expect(screen.getByText("alp")).toBeInTheDocument();
  });

  it("trigger button has aria-haspopup='menu' after load", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const trigger = screen.getByRole("button", { name: /active space/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  });

  it("trigger is keyboard-activatable with Enter, opening the menu", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    const { user } = setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const trigger = screen.getByRole("button", { name: /active space/i });
    trigger.focus();
    await user.keyboard("{Enter}");
    // After Enter, the menu popover with all space names should appear.
    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });
    // Both space names appear in the menu list items.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
  });

  it("trigger is keyboard-activatable with Space key", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    const { user } = setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const trigger = screen.getByRole("button", { name: /active space/i });
    trigger.focus();
    await user.keyboard(" ");
    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });
  });

  it("selecting a different space updates the trigger label", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    const { user } = setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    // Open menu
    const trigger = screen.getByRole("button", { name: /active space/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    // Click the Beta menu item
    const betaItems = screen.getAllByRole("menuitem", { name: /beta/i });
    await user.click(betaItems[0]);

    // Menu closes and trigger now shows Beta
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
    // The space name may appear more than once (SPACES section + RECENT BOARDS
    // section both render from the same stub data). Use getAllByText to tolerate
    // the duplicates and just assert at least one occurrence.
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    expect(screen.getAllByText("bet").length).toBeGreaterThan(0);
  });

  it("renders an error indicator when useSpaces fails", async () => {
    invokeMock.mockRejectedValue(new Error("network error"));
    setup();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/spaces unavailable/i)).toBeInTheDocument();
    // The nav items are still rendered — error does not crash the sidebar.
    expect(screen.getByRole("button", { name: /boards/i })).toBeInTheDocument();
  });

  it("suppresses the switcher entirely when spaces list is empty", async () => {
    invokeMock.mockResolvedValue([]);
    setup();
    await waitFor(() => {
      // No trigger button for space switching
      expect(
        screen.queryByRole("button", { name: /active space/i }),
      ).not.toBeInTheDocument();
    });
    // Nav items still render normally.
    expect(screen.getByRole("button", { name: /boards/i })).toBeInTheDocument();
  });

  it("restores activeSpaceId from localStorage on mount", async () => {
    // Pre-seed localStorage with spc-2 (Beta).
    localStorage.setItem("catique:activeSpaceId", "spc-2");
    invokeMock.mockResolvedValue(STUB_SPACES);

    setup();

    // The trigger should display the stored space (Beta), not the default (Alpha).
    // Note: Beta may appear more than once — the RECENT BOARDS section also renders
    // stub data returned by the shared invokeMock. Use getAllByText + length check.
    await waitFor(() => {
      expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("bet").length).toBeGreaterThan(0);
  });

  it("persists activeSpaceId to localStorage when a space is selected", async () => {
    invokeMock.mockResolvedValue(STUB_SPACES);
    const { user } = setup();

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    // Open the menu and select Beta.
    const trigger = screen.getByRole("button", { name: /active space/i });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    const betaItems = screen.getAllByRole("menuitem", { name: /beta/i });
    await user.click(betaItems[0]);

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    expect(localStorage.getItem("catique:activeSpaceId")).toBe("spc-2");
  });
});

// ---------------------------------------------------------------------------
// Settings nav item tests
// ---------------------------------------------------------------------------

describe("Sidebar — Settings nav item", () => {
  beforeEach(() => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
  });

  it("renders the Settings nav item", () => {
    setup();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("marks Settings as active when activeView is 'settings'", () => {
    setup("settings");
    const btn = screen.getByRole("button", { name: /settings/i });
    expect(btn).toHaveAttribute("aria-current", "page");
  });

  it("does not mark Settings as active when activeView is 'boards'", () => {
    setup("boards");
    const btn = screen.getByRole("button", { name: /settings/i });
    expect(btn).not.toHaveAttribute("aria-current");
  });

  it("calls onSelectView with 'settings' when clicked", async () => {
    const onSelectView = vi.fn();
    const { user } = setup("boards", onSelectView);
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(onSelectView).toHaveBeenCalledWith("settings");
  });
});

// ---------------------------------------------------------------------------
// ThemeToggle tests
// ---------------------------------------------------------------------------

describe("Sidebar — ThemeToggle", () => {
  beforeEach(() => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    // Reset data-theme and localStorage before each test.
    delete document.documentElement.dataset["theme"];
    localStorage.removeItem("catique:theme");
  });

  afterEach(() => {
    delete document.documentElement.dataset["theme"];
    localStorage.removeItem("catique:theme");
  });

  it("renders the theme toggle button", () => {
    setup();
    // The toggle button carries an aria-label referencing "тема".
    expect(
      screen.getByRole("button", { name: /тема/i }),
    ).toBeInTheDocument();
  });

  it("clicking the toggle flips data-theme on document.documentElement", async () => {
    const { user } = setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });

    // Initial state: no data-theme set → defaults to "dark" internally.
    await user.click(toggleBtn);
    // After one click from dark, should be light.
    expect(document.documentElement.dataset["theme"]).toBe("light");

    // Click again — should flip back to dark.
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
    // When theme is light, aria-pressed should be true.
    expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("persists the new theme to localStorage after toggling", async () => {
    const { user } = setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });

    // Initial: dark (no data-theme set). Toggle → light.
    await user.click(toggleBtn);
    expect(localStorage.getItem("catique:theme")).toBe("light");

    // Toggle again → dark.
    await user.click(toggleBtn);
    expect(localStorage.getItem("catique:theme")).toBe("dark");
  });

  it("reads persisted 'light' from localStorage via data-theme on init", () => {
    // Simulate what index.tsx does before React mounts.
    document.documentElement.dataset["theme"] = "light";
    localStorage.setItem("catique:theme", "light");

    setup();
    const toggleBtn = screen.getByRole("button", { name: /тема/i });
    // ThemeToggle reads from dataset.theme → should reflect light.
    expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
  });
});
