import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { RoleContentVersionView } from "@bindings/RoleContentVersionView";
import { ToastProvider } from "@shared/lib";

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
import { HistoryViewerButton } from "../HistoryViewerButton";

const invokeMock = vi.mocked(invoke);

function makeVersion(
  overrides: Partial<RoleContentVersionView> = {},
): RoleContentVersionView {
  return {
    id: "ver-1",
    roleId: "role-1",
    content: "previous body",
    createdAt: BigInt(Date.now() - 5 * 60_000),
    authorNote: null,
    ...overrides,
  };
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { client, user };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HistoryViewerButton", () => {
  it("renders the trigger button with the right label and testid", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(
      <HistoryViewerButton
        title="Agent content history"
        kind="role"
        sourceId="role-1"
        currentContent="current"
      />,
    );
    const trigger = screen.getByTestId("history-viewer-button");
    expect(trigger).toHaveTextContent("History");
    expect(trigger).toHaveAttribute(
      "aria-label",
      "Open Agent content history",
    );
  });

  it("opens the dialog and lists every version returned by IPC", async () => {
    const versions: RoleContentVersionView[] = [
      makeVersion({ id: "ver-1", content: "first body" }),
      makeVersion({
        id: "ver-2",
        content: "second body",
        createdAt: BigInt(Date.now() - 30 * 60_000),
      }),
    ];
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "list_role_versions") return versions;
      if (cmd === "get_role_version") {
        const id = (args as { versionId: string }).versionId;
        return versions.find((v) => v.id === id) ?? versions[0];
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <HistoryViewerButton
        title="Agent content history"
        kind="role"
        sourceId="role-1"
        currentContent="current body"
        data-testid="role-editor-history"
      />,
    );

    await user.click(screen.getByTestId("role-editor-history"));

    const dialog = await screen.findByTestId("role-editor-history-dialog");
    expect(dialog).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByTestId("role-editor-history-row-ver-1"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("role-editor-history-row-ver-2"),
    ).toBeInTheDocument();
  });

  it("shows the selected version's content in the right pane", async () => {
    const versions: RoleContentVersionView[] = [
      makeVersion({ id: "ver-1", content: "newest body" }),
      makeVersion({
        id: "ver-2",
        content: "older body",
        createdAt: BigInt(Date.now() - 30 * 60_000),
      }),
    ];
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "list_role_versions") return versions;
      if (cmd === "get_role_version") {
        const id = (args as { versionId: string }).versionId;
        return versions.find((v) => v.id === id) ?? versions[0];
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <HistoryViewerButton
        title="Agent content history"
        kind="role"
        sourceId="role-1"
        currentContent="current body"
        data-testid="role-editor-history"
      />,
    );
    await user.click(screen.getByTestId("role-editor-history"));

    await screen.findByTestId("role-editor-history-row-ver-1");

    // Default selection is the newest row → its content shows in the preview.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("role-editor-history-preview")).getByText(
          /newest body/,
        ),
      ).toBeInTheDocument();
    });

    // Click the older row, its body becomes the preview source.
    await user.click(screen.getByTestId("role-editor-history-row-ver-2"));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("role-editor-history-preview")).getByText(
          /older body/,
        ),
      ).toBeInTheDocument();
    });
  });

  it("opens a confirm dialog from the row action menu and reverts on confirm", async () => {
    const versions: RoleContentVersionView[] = [
      makeVersion({ id: "ver-1", content: "previous body" }),
    ];
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "list_role_versions") return versions;
      if (cmd === "get_role_version") return versions[0];
      if (cmd === "revert_role_to_version") {
        // Mirror the Rust return shape — we only assert on the call below.
        return {
          id: "role-1",
          name: "Role",
          content: (args as { versionId: string }).versionId,
          color: null,
          icon: null,
          isSystem: false,
          createdAt: 0n,
          updatedAt: 0n,
        };
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <HistoryViewerButton
        title="Agent content history"
        kind="role"
        sourceId="role-1"
        currentContent="current body"
        data-testid="role-editor-history"
      />,
    );
    await user.click(screen.getByTestId("role-editor-history"));
    await screen.findByTestId("role-editor-history-row-ver-1");

    // Open the per-row action menu.
    await user.click(screen.getByTestId("role-editor-history-row-ver-1-menu"));
    // RAC Menu items have role="menuitem" — the visible label is stable.
    await user.click(
      await screen.findByRole("menuitem", { name: /revert to this version/i }),
    );

    // Confirm dialog appears.
    const confirm = await screen.findByTestId(
      "role-editor-history-revert-confirm",
    );
    expect(confirm).toBeInTheDocument();

    await user.click(
      screen.getByTestId("role-editor-history-revert-confirm-confirm"),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("revert_role_to_version", {
        versionId: "ver-1",
      });
    });
  });

  it("renders an empty state when no versions exist", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_role_versions") return [];
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <HistoryViewerButton
        title="Agent content history"
        kind="role"
        sourceId="role-1"
        currentContent="current body"
        data-testid="role-editor-history"
      />,
    );
    await user.click(screen.getByTestId("role-editor-history"));

    const empty = await screen.findByTestId("role-editor-history-empty");
    expect(empty).toHaveTextContent("No version history yet");
  });
});
