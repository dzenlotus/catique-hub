import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { LocalStorageStore, stringCodec } from "@shared/storage";
import { MainSidebar } from "./MainSidebar";
import type { NavView } from "./MainSidebar";

const activeSpaceStore = new LocalStorageStore<string>({
  key: "catique:activeSpaceId",
  codec: stringCodec,
});

// ---------------------------------------------------------------------------
// Mock the Tauri invoke wrapper — ActiveSpaceProvider runs useSpaces() on
// mount and we don't want a real IPC roundtrip here.
// ---------------------------------------------------------------------------
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";

const invokeMock = vi.mocked(invoke);

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

const ALL_VIEWS: NavView[] = [
  "boards",
  "agent-roles",
  "prompts",
  "skills",
  "mcp-servers",
  "settings",
];

function setup(
  activeView: NavView = "boards",
  onSelectView = vi.fn(),
): { user: ReturnType<typeof userEvent.setup> } {
  return renderWithClient(
    <MainSidebar activeView={activeView} onSelectView={onSelectView} />,
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => new Promise(() => {}));
  activeSpaceStore.remove();
});

afterEach(() => {
  vi.restoreAllMocks();
  activeSpaceStore.remove();
});

// ---------------------------------------------------------------------------
// Wordmark + section labels
// ---------------------------------------------------------------------------

describe("MainSidebar — wordmark + section labels", () => {
  it("renders the 'Catique Hub' wordmark", () => {
    setup();
    expect(screen.getByText("Catique Hub")).toBeInTheDocument();
  });

  it("does NOT render a 'WORKSPACE' section label (Round 20)", () => {
    setup();
    expect(screen.queryByText(/^WORKSPACE$/)).not.toBeInTheDocument();
  });

  it("does NOT render the SPACES section (lives in SpacesSidebar)", () => {
    setup();
    expect(screen.queryByText(/^SPACES$/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

describe("MainSidebar — nav items", () => {
  it("renders all 6 workspace nav items", () => {
    setup();
    expect(screen.getByRole("button", { name: /^boards$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /agent roles/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^prompts$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^skills$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mcp servers/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^settings$/i })).toBeInTheDocument();
  });

  it("does NOT render a 'Prompt groups' nav item (round-19c merge)", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: /prompt groups/i }),
    ).not.toBeInTheDocument();
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
      const labelMap: Record<NavView, RegExp> = {
        boards: /^boards$/i,
        "agent-roles": /agent roles/i,
        prompts: /^prompts$/i,
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
    const inactiveRegexes = [
      /agent roles/i,
      /^prompts$/i,
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
