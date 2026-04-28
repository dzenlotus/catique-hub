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

  it("renders 'Установлен' pill when installed is true", () => {
    render(<ConnectedClientCard client={makeClient({ installed: true })} />);
    expect(screen.getByTestId("client-installed-pill")).toHaveTextContent(
      "Установлен",
    );
  });

  it("renders 'Не найден' pill when installed is false", () => {
    render(<ConnectedClientCard client={makeClient({ installed: false })} />);
    expect(screen.getByTestId("client-installed-pill")).toHaveTextContent(
      "Не найден",
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
});
