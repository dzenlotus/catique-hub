import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { PromptGroup } from "../../model/types";
import { PromptGroupCard } from "./PromptGroupCard";

// Mock Tauri invoke at the shared/api boundary so the internal
// usePromptGroupMembers query can be driven by the test.
vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invoke } from "@shared/api";

const invokeMock = vi.mocked(invoke);

function makeGroup(overrides: Partial<PromptGroup> = {}): PromptGroup {
  return {
    id: "group-001",
    name: "Core Prompts",
    color: null,
    icon: null,
    position: 0n,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderWithClient(ui: ReactElement): ReturnType<typeof userEvent.setup> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return user;
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("PromptGroupCard", () => {
  it("renders skeleton when isPending", () => {
    invokeMock.mockResolvedValue([]);
    renderWithClient(<PromptGroupCard isPending />);
    expect(screen.getByTestId("prompt-group-card-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders skeleton when no group is provided", () => {
    invokeMock.mockResolvedValue([]);
    renderWithClient(<PromptGroupCard />);
    expect(screen.getByTestId("prompt-group-card-skeleton")).toBeInTheDocument();
  });

  it("renders the group name as a button", async () => {
    invokeMock.mockResolvedValue([]);
    renderWithClient(<PromptGroupCard group={makeGroup({ name: "My Group" })} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
    expect(screen.getByText("My Group")).toBeInTheDocument();
  });

  it("renders member count after loading", async () => {
    invokeMock.mockResolvedValue(["pid-1", "pid-2"]);
    renderWithClient(<PromptGroupCard group={makeGroup()} />);
    await waitFor(() => {
      expect(screen.getByText("2 prompts")).toBeInTheDocument();
    });
  });

  it("renders '1 prompt' for a single member", async () => {
    invokeMock.mockResolvedValue(["pid-1"]);
    renderWithClient(<PromptGroupCard group={makeGroup()} />);
    await waitFor(() => {
      expect(screen.getByText("1 prompt")).toBeInTheDocument();
    });
  });

  it("renders '0 prompts' for empty member list", async () => {
    invokeMock.mockResolvedValue([]);
    renderWithClient(<PromptGroupCard group={makeGroup()} />);
    await waitFor(() => {
      expect(screen.getByText("0 prompts")).toBeInTheDocument();
    });
  });

  it("renders the position chip", async () => {
    invokeMock.mockResolvedValue([]);
    renderWithClient(<PromptGroupCard group={makeGroup({ position: 5n })} />);
    await waitFor(() => {
      expect(screen.getByText("#5")).toBeInTheDocument();
    });
  });

  it("renders a color swatch when color is set", async () => {
    invokeMock.mockResolvedValue([]);
    renderWithClient(
      <PromptGroupCard group={makeGroup({ color: "#ff5733" })} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Color: #ff5733")).toBeInTheDocument();
    });
  });

  it("does not render a color swatch when color is null", async () => {
    invokeMock.mockResolvedValue([]);
    renderWithClient(<PromptGroupCard group={makeGroup({ color: null })} />);
    await waitFor(() => {
      expect(screen.queryByLabelText(/color/i)).not.toBeInTheDocument();
    });
  });

  it("fires onSelect on click with the group id", async () => {
    invokeMock.mockResolvedValue([]);
    const onSelect = vi.fn();
    const user = renderWithClient(
      <PromptGroupCard
        group={makeGroup({ id: "group-xyz" })}
        onSelect={onSelect}
      />,
    );
    await waitFor(() => screen.getByRole("button"));
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("group-xyz");
  });

  it("fires onSelect when activated with Enter", async () => {
    invokeMock.mockResolvedValue([]);
    const onSelect = vi.fn();
    const user = renderWithClient(
      <PromptGroupCard
        group={makeGroup({ id: "group-enter" })}
        onSelect={onSelect}
      />,
    );
    await waitFor(() => screen.getByRole("button"));
    screen.getByRole("button").focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("group-enter");
  });
});
