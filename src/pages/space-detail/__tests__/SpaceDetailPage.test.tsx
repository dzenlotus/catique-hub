/**
 * SpaceDetailPage — Activity log type-filter chip strip (Round 4 / Stream P).
 *
 * The activity-log section gains a chip strip above the event list:
 *   [ All ] [ Tasks ] [ Boards ] [ Prompts ] [ Edits ]
 *
 * Filtering is purely client-side over the result of
 * `useRecentActivityEventsByScope("space", spaceId, 20)` — no new IPC.
 * "Edits" matches any event name ending `:updated`, which is how D-D's
 * Tier-3 compaction marks coalesced rows.
 *
 * Provider chain mirrors BoardSettings: QueryClient > ActiveSpace >
 * Toast > TestRouter. `useParamsCompat` is mocked to pin the spaceId
 * so the page resolves without a real router.
 *
 * `useNavigate` from `@tanstack/react-router` is mocked because the
 * page imports it directly (not via the compat layer); without a real
 * `<RouterProvider>` the native hook would throw on first render.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// Pin spaceId for the page under test.
vi.mock("@shared/lib", async () => {
  const actual = await vi.importActual<typeof import("@shared/lib")>(
    "@shared/lib",
  );
  return {
    ...actual,
    useParamsCompat: () => ({ spaceId: "spc-1" }),
  };
});

// `useNavigate` is called unconditionally inside SpaceDetailPage; the
// real hook throws without a TanStack `<RouterProvider>` in scope.
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<
    typeof import("@tanstack/react-router")
  >("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>(
    "@shared/api",
  );
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
    on: vi.fn(() => Promise.resolve(() => {})),
  };
});

import type { Board } from "@entities/board";
import type { Role } from "@entities/role";
import type { Space } from "@entities/space";
import type { ActivityEvent } from "@bindings/ActivityEvent";
import { ActiveSpaceProvider } from "@app/providers";
import { ToastProvider } from "@shared/lib";
import { TestRouter } from "@shared/lib";
import { invoke } from "@shared/api";
import { SpaceDetailPage } from "../SpaceDetailPage";

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "spc-1",
    name: "Main",
    prefix: "main",
    description: null,
    color: null,
    icon: null,
    isDefault: true,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    workflowGraphJson: null,
    projectFolderPath: null,
    ...overrides,
  };
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-1",
    name: "Engineer",
    content: "",
    color: null,
    icon: null,
    isSystem: false,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "brd-1",
    name: "Sprint",
    spaceId: "spc-1",
    roleId: "role-1",
    position: 1,
    description: null,
    color: null,
    icon: null,
    isDefault: false,
    ownerRoleId: "role-1",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    seq: 1n,
    name: "task:created",
    payloadJson: "{}",
    scopeKind: "space",
    scopeId: "spc-1",
    count: 1n,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// IPC mock
// ---------------------------------------------------------------------------

interface MockOptions {
  events: ActivityEvent[];
}

function installInvokeMock(opts: MockOptions): void {
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "get_space") return makeSpace();
    if (cmd === "list_spaces") return [makeSpace()];
    if (cmd === "list_boards") return [makeBoard()];
    if (cmd === "list_roles") return [makeRole()];
    if (cmd === "list_recent_events_by_scope") return opts.events;
    if (cmd === "list_recent_events") return opts.events;
    // Tolerate ancillary calls (e.g. settings sync) without failing.
    return null;
  });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPage(): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <ActiveSpaceProvider>
        <ToastProvider>
          <TestRouter path="/spaces/spc-1">
            <SpaceDetailPage />
          </TestRouter>
        </ToastProvider>
      </ActiveSpaceProvider>
    </QueryClientProvider>
  );
  render(tree);
  return { user };
}

async function openActivityLog(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  // The page is loading the space query first — wait for the body to
  // resolve before reaching for the collapsible.
  const section = await screen.findByTestId("space-detail-activity-section");
  const toggle = within(section).getByRole("button", { name: /activity log/i });
  await user.click(toggle);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  invokeMock.mockReset();
  // Clean localStorage between tests so ActiveSpaceProvider state
  // doesn't leak across cases.
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpaceDetailPage — activity-log type filter (Stream P)", () => {
  it("renders the chip strip with five chips when the log is expanded", async () => {
    installInvokeMock({
      events: [
        makeEvent({ seq: 1n, name: "task:created" }),
        makeEvent({ seq: 2n, name: "board:updated" }),
      ],
    });

    const { user } = renderPage();
    await openActivityLog(user);

    const chips = await screen.findByTestId("space-detail-activity-chips");
    const tabs = within(chips).getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(tabs.map((t) => t.textContent)).toEqual([
      "All",
      "Tasks",
      "Boards",
      "Prompts",
      "Edits",
    ]);

    // "All" is selected by default.
    expect(
      screen.getByTestId("space-detail-activity-chip-all"),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("filters to task:* events when the Tasks chip is clicked", async () => {
    installInvokeMock({
      events: [
        makeEvent({ seq: 10n, name: "task:created" }),
        makeEvent({ seq: 11n, name: "task:updated" }),
        makeEvent({ seq: 12n, name: "board:created" }),
        makeEvent({ seq: 13n, name: "board:updated" }),
      ],
    });

    const { user } = renderPage();
    await openActivityLog(user);

    // Wait until the unfiltered list has rendered.
    await waitFor(() => {
      expect(
        screen.getByTestId("space-detail-activity-12"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("space-detail-activity-chip-tasks"));

    // task events remain, board events are gone.
    expect(screen.getByTestId("space-detail-activity-10")).toBeInTheDocument();
    expect(screen.getByTestId("space-detail-activity-11")).toBeInTheDocument();
    expect(
      screen.queryByTestId("space-detail-activity-12"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("space-detail-activity-13"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("space-detail-activity-chip-tasks"),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("filters to events ending in `:updated` when Edits is clicked", async () => {
    installInvokeMock({
      events: [
        makeEvent({ seq: 20n, name: "task:created" }),
        makeEvent({ seq: 21n, name: "task:updated" }),
        makeEvent({ seq: 22n, name: "prompt:updated", count: 8n }),
        makeEvent({ seq: 23n, name: "board:archived" }),
      ],
    });

    const { user } = renderPage();
    await openActivityLog(user);

    await waitFor(() => {
      expect(
        screen.getByTestId("space-detail-activity-20"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("space-detail-activity-chip-edits"));

    expect(screen.getByTestId("space-detail-activity-21")).toBeInTheDocument();
    expect(screen.getByTestId("space-detail-activity-22")).toBeInTheDocument();
    expect(
      screen.queryByTestId("space-detail-activity-20"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("space-detail-activity-23"),
    ).not.toBeInTheDocument();
  });

  it("renders the `× N` suffix for events with count > 1 (Tier-3 compacted)", async () => {
    installInvokeMock({
      events: [
        makeEvent({ seq: 30n, name: "prompt:updated", count: 8n }),
        makeEvent({ seq: 31n, name: "task:created", count: 1n }),
      ],
    });

    const { user } = renderPage();
    await openActivityLog(user);

    const compactBadge = await screen.findByTestId(
      "space-detail-activity-count-30",
    );
    expect(compactBadge).toHaveTextContent("× 8");

    // The non-compacted event has no count badge.
    expect(
      screen.queryByTestId("space-detail-activity-count-31"),
    ).not.toBeInTheDocument();
  });

  it("shows `No matching events.` when the filter excludes everything", async () => {
    installInvokeMock({
      events: [makeEvent({ seq: 40n, name: "task:created" })],
    });

    const { user } = renderPage();
    await openActivityLog(user);

    await waitFor(() => {
      expect(
        screen.getByTestId("space-detail-activity-40"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("space-detail-activity-chip-boards"));

    expect(
      screen.getByTestId("space-detail-activity-empty"),
    ).toHaveTextContent(/no matching events/i);
  });
});
