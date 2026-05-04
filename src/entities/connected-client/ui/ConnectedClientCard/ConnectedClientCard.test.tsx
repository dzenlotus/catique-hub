import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ConnectedClient } from "../../model/types";
import { ConnectedClientCard } from "./ConnectedClientCard";

function makeClient(overrides: Partial<ConnectedClient> = {}): ConnectedClient {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    configDir: "/Users/test/.claude",
    signatureFile: "/Users/test/.claude/settings.json",
    installed: true,
    enabled: true,
    lastSeenAt: 0n,
    supportsRoleSync: true,
    ...overrides,
  };
}

describe("ConnectedClientCard", () => {
  it("renders the skeleton when isPending", () => {
    render(<ConnectedClientCard isPending />);
    expect(
      screen.getByTestId("connected-client-card-skeleton"),
    ).toBeInTheDocument();
  });

  it("renders the skeleton when no client is provided", () => {
    render(<ConnectedClientCard />);
    expect(
      screen.getByTestId("connected-client-card-skeleton"),
    ).toBeInTheDocument();
  });

  it("renders the display name", () => {
    render(<ConnectedClientCard client={makeClient()} />);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("renders the config dir path", () => {
    render(<ConnectedClientCard client={makeClient()} />);
    expect(
      screen.getByTestId("client-config-path"),
    ).toHaveTextContent("/Users/test/.claude");
  });

  it("renders 'Installed' pill when installed is true", () => {
    render(<ConnectedClientCard client={makeClient({ installed: true })} />);
    expect(screen.getByTestId("client-installed-pill")).toHaveTextContent(
      "Installed",
    );
  });

  it("renders 'Not found' pill when installed is false", () => {
    render(<ConnectedClientCard client={makeClient({ installed: false })} />);
    expect(screen.getByTestId("client-installed-pill")).toHaveTextContent(
      "Not found",
    );
  });

  it("toggle has aria-checked=true when enabled", () => {
    render(<ConnectedClientCard client={makeClient({ enabled: true })} />);
    expect(screen.getByTestId("client-enabled-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("toggle has aria-checked=false when disabled", () => {
    render(<ConnectedClientCard client={makeClient({ enabled: false })} />);
    expect(screen.getByTestId("client-enabled-toggle")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls onToggleEnabled with negated state on click", async () => {
    const onToggle = vi.fn();
    render(
      <ConnectedClientCard
        client={makeClient({ id: "cursor", enabled: true })}
        onToggleEnabled={onToggle}
      />,
    );
    await userEvent.click(screen.getByTestId("client-enabled-toggle"));
    expect(onToggle).toHaveBeenCalledWith("cursor", false);
  });

  it("disables the toggle when isToggling is true", () => {
    render(
      <ConnectedClientCard
        client={makeClient()}
        isToggling
      />,
    );
    expect(screen.getByTestId("client-enabled-toggle")).toBeDisabled();
  });

  // ── Role-sync (ctq-69) ───────────────────────────────────────────────

  it("renders the sync roles button when supportsRoleSync is true", () => {
    render(<ConnectedClientCard client={makeClient({ supportsRoleSync: true })} />);
    expect(screen.getByTestId("client-sync-roles-btn")).toBeInTheDocument();
  });

  it("renders 'не поддерживается' hint when supportsRoleSync is false", () => {
    render(
      <ConnectedClientCard client={makeClient({ supportsRoleSync: false })} />,
    );
    expect(screen.getByTestId("client-sync-not-supported")).toBeInTheDocument();
    expect(screen.queryByTestId("client-sync-roles-btn")).not.toBeInTheDocument();
  });

  it("disables sync button when isSyncing is true", () => {
    render(
      <ConnectedClientCard
        client={makeClient({ supportsRoleSync: true })}
        isSyncing
      />,
    );
    expect(screen.getByTestId("client-sync-roles-btn")).toBeDisabled();
  });

  it("calls onSyncRoles with the client id on sync button click", async () => {
    const onSync = vi.fn();
    render(
      <ConnectedClientCard
        client={makeClient({ id: "cursor", supportsRoleSync: true })}
        onSyncRoles={onSync}
      />,
    );
    await userEvent.click(screen.getByTestId("client-sync-roles-btn"));
    expect(onSync).toHaveBeenCalledWith("cursor");
  });

  it("renders synced roles list when syncedRoles is provided", () => {
    render(
      <ConnectedClientCard
        client={makeClient({ supportsRoleSync: true })}
        syncedRoles={[
          {
            clientId: "claude-code",
            roleId: "backend-engineer",
            filePath: "/Users/test/.claude/agents/catique-backend-engineer.md",
            syncedAt: 1_000n,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("client-synced-roles-list")).toBeInTheDocument();
    expect(screen.getByText("backend-engineer")).toBeInTheDocument();
  });

  it("does not render synced roles list when syncedRoles is empty", () => {
    render(
      <ConnectedClientCard
        client={makeClient({ supportsRoleSync: true })}
        syncedRoles={[]}
      />,
    );
    expect(
      screen.queryByTestId("client-synced-roles-list"),
    ).not.toBeInTheDocument();
  });
});
