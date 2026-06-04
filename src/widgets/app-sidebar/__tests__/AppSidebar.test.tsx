/**
 * AppSidebar — a11y smoke tests (Stream L round-3 polish).
 *
 * Verifies:
 *   - The unified sidebar renders the "SPACES" section heading as a peer
 *     of "Pinned" / "Recent" rather than letting `SpacesSidebar` paint
 *     its own duplicate header. The embedded `<SpacesSidebar/>` mount
 *     should NOT produce a second `<aside>` landmark.
 *   - The collapse toggle reads as a button with the correct
 *     `aria-pressed` semantics and toggles via the keyboard.
 *   - The expected DOM focus order matches the visual order
 *     (search → pinned/recent → spaces tree rows → top-level nav → footer).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { TestRouter } from "@shared/lib";
import { ActiveSpaceProvider } from "@app/providers";
import { ExpandedSpacesProvider } from "@app/providers/ExpandedSpacesProvider";
import { ToastProvider } from "@shared/lib";

import { AppSidebar } from "../AppSidebar";

// ─── IPC mock ─────────────────────────────────────────────────────────────────

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

// ─── Stub data ────────────────────────────────────────────────────────────────

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
];

const STUB_BOARDS = [
  {
    id: "brd-1",
    name: "Engineering",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearShellPrefs(): void {
  // The sidebar reads `catique:sidebarCollapsed` and the expand-state map
  // from localStorage at mount time. Wipe both so each test starts from a
  // known (expanded, untoggled) baseline.
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (
      key !== null &&
      (key.startsWith("catique:sidebar") ||
        key === "catique:activeSpaceId")
    ) {
      localStorage.removeItem(key);
    }
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderSidebar(): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  render(
    <TestRouter path="/">
      <QueryClientProvider client={makeQueryClient()}>
        <ToastProvider>
          <ActiveSpaceProvider>
            <ExpandedSpacesProvider>
              <AppSidebar activeView="agent-roles" onSelectView={vi.fn()} />
            </ExpandedSpacesProvider>
          </ActiveSpaceProvider>
        </ToastProvider>
      </QueryClientProvider>
    </TestRouter>,
  );
  return { user };
}

function renderSidebarUI(ui: ReactElement): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const user = userEvent.setup();
  render(
    <TestRouter path="/">
      <QueryClientProvider client={makeQueryClient()}>
        <ToastProvider>
          <ActiveSpaceProvider>
            <ExpandedSpacesProvider>{ui}</ExpandedSpacesProvider>
          </ActiveSpaceProvider>
        </ToastProvider>
      </QueryClientProvider>
    </TestRouter>,
  );
  return { user };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: unknown) => {
    if (cmd === "list_spaces") return Promise.resolve(STUB_SPACES);
    if (cmd === "list_boards") return Promise.resolve(STUB_BOARDS);
    return Promise.resolve([]);
  });
  clearShellPrefs();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearShellPrefs();
});

// ─────────────────────────────────────────────────────────────────────────────
// Embedded SpacesSidebar — no duplicate `<aside>` landmark.
// ─────────────────────────────────────────────────────────────────────────────

describe("AppSidebar — embedded SpacesSidebar", () => {
  it("renders a single 'Main navigation' landmark (no nested aside)", async () => {
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    // The unified sidebar is a `<nav>` labelled "Main navigation". The
    // embedded `SpacesSidebar` must NOT render a sibling `<aside>` —
    // doing so would create a second landmark + a duplicated SPACES
    // header.
    expect(
      screen.queryByRole("complementary", { name: /spaces navigation/i }),
    ).not.toBeInTheDocument();

    // Exactly one "PROJECTS" heading text, sitting inside the embedded
    // root.
    const headings = screen.getAllByText(/^PROJECTS$/);
    expect(headings).toHaveLength(1);
  });

  it("exposes a single spaces-sidebar-root data-testid (embedded mode)", async () => {
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const roots = screen.getAllByTestId("spaces-sidebar-root");
    expect(roots).toHaveLength(1);
    // Embedded root is a plain `<div>`, not an `<aside>`. AT users still
    // get the outer `<nav aria-label="Main navigation">` landmark.
    expect(roots[0].tagName).toBe("DIV");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Focus order — spaces tree → top-level nav → settings.
// (Pinned / Recent sections are empty by default because the harness
//  clears their storage slots; the inline sidebar search + collapse toggle
//  were removed, so the order collapses to tree → top nav → footer.)
// ─────────────────────────────────────────────────────────────────────────────

describe("AppSidebar — focus order (Tab)", () => {
  it("cycles focus from spaces tree → top-level nav → footer", async () => {
    const { user } = renderSidebar();

    // Wait for the spaces query to resolve so the tree row is in the DOM.
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    // The top-level nav entries — Agents / Prompts / Skills / Integrations —
    // come after the SPACES tree (now rendered via EntityTree).
    const agentsNav = screen.getByTestId("app-sidebar-nav-agent-roles");

    // Footer Settings is last.
    const settingsNav = screen.getByTestId("app-sidebar-nav-settings");

    // Start focus before the sidebar entirely, then tab through. Use
    // `userEvent.tab()` so the harness honours the DOM tab order. Tab until
    // we land on the Agents nav button — every intermediate stop must be
    // focusable (no `tabindex=-1` traps).
    document.body.focus();
    let safety = 30;
    while (document.activeElement !== agentsNav && safety > 0) {
      await user.tab();
      safety -= 1;
    }
    expect(agentsNav).toHaveFocus();

    // From Agents → through Prompts / Skills / Integrations → Settings.
    safety = 10;
    while (document.activeElement !== settingsNav && safety > 0) {
      await user.tab();
      safety -= 1;
    }
    expect(settingsNav).toHaveFocus();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Smoke — render with the same shape the host uses.
// ─────────────────────────────────────────────────────────────────────────────

describe("AppSidebar — smoke", () => {
  it("renders the top-level nav buttons", async () => {
    renderSidebarUI(
      <AppSidebar activeView="agent-roles" onSelectView={vi.fn()} />,
    );
    expect(
      await screen.findByTestId("app-sidebar-nav-agent-roles"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("app-sidebar-nav-prompts"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("app-sidebar-nav-skills"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("app-sidebar-nav-mcp-servers"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("app-sidebar-nav-settings"),
    ).toBeInTheDocument();
  });
});
