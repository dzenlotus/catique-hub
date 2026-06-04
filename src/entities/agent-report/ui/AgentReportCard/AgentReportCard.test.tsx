import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AgentReport } from "../../model/types";
import { AgentReportCard, formatRelativeTime } from "./AgentReportCard";

function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
  return {
    id: "report-001",
    taskId: "task-abc",
    kind: "investigation",
    title: "Initial investigation findings",
    content: "Found several issues with the authentication flow.",
    author: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("AgentReportCard", () => {
  it("renders the report title", () => {
    render(<AgentReportCard report={makeReport({ title: "My Report" })} />);
    expect(screen.getByText("My Report")).toBeInTheDocument();
  });

  it("renders the kind chip", () => {
    render(<AgentReportCard report={makeReport({ kind: "review" })} />);
    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("renders the content preview", () => {
    render(
      <AgentReportCard
        report={makeReport({ content: "Important findings here." })}
      />,
    );
    expect(screen.getByText("Important findings here.")).toBeInTheDocument();
  });

  it("uses a native <button> with implicit role=button (a11y)", () => {
    render(<AgentReportCard report={makeReport()} />);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onSelect on click with the report id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentReportCard
        report={makeReport({ id: "report-xyz" })}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("report-xyz");
  });

  it("fires onSelect when activated with the Enter key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentReportCard
        report={makeReport({ id: "report-enter" })}
        onSelect={onSelect}
      />,
    );
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("report-enter");
  });

  it("fires onSelect when activated with the Space key", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentReportCard
        report={makeReport({ id: "report-space" })}
        onSelect={onSelect}
      />,
    );
    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("report-space");
  });

  it("renders a skeleton when isPending", () => {
    render(<AgentReportCard isPending />);
    expect(
      screen.getByTestId("agent-report-card-skeleton"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a skeleton when no report is provided", () => {
    render(<AgentReportCard />);
    expect(
      screen.getByTestId("agent-report-card-skeleton"),
    ).toBeInTheDocument();
  });

  it("renders a timestamp element", () => {
    render(<AgentReportCard report={makeReport()} />);
    expect(screen.getByLabelText("Created at")).toBeInTheDocument();
  });

  it("renders kind chip with aria-label", () => {
    render(<AgentReportCard report={makeReport({ kind: "memo" })} />);
    expect(screen.getByLabelText("Kind: memo")).toBeInTheDocument();
  });
});

describe("formatRelativeTime", () => {
  it("returns 'just now' for very recent timestamps", () => {
    const now = BigInt(Date.now() - 10_000); // 10 seconds ago
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("returns minutes ago for timestamps within an hour", () => {
    const fiveMinAgo = BigInt(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinAgo)).toBe("5 min ago");
  });

  it("returns hours ago for timestamps within a day", () => {
    const threeHoursAgo = BigInt(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeHoursAgo)).toBe("3 hours ago");
  });

  it("returns singular 'hour' for exactly 1 hour ago", () => {
    const oneHourAgo = BigInt(Date.now() - 1 * 60 * 60 * 1000);
    expect(formatRelativeTime(oneHourAgo)).toBe("1 hour ago");
  });

  it("returns days ago for timestamps within 30 days", () => {
    const twoDaysAgo = BigInt(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoDaysAgo)).toBe("2 days ago");
  });

  it("returns singular 'day' for exactly 1 day ago", () => {
    const oneDayAgo = BigInt(Date.now() - 1 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(oneDayAgo)).toBe("1 day ago");
  });

  it("returns an absolute date string for old timestamps", () => {
    const old = BigInt(new Date("2020-01-01").getTime());
    const result = formatRelativeTime(old);
    expect(result).toMatch(/2020/);
  });

  it("returns 'just now' for future timestamps", () => {
    const future = BigInt(Date.now() + 60_000);
    expect(formatRelativeTime(future)).toBe("just now");
  });
});
