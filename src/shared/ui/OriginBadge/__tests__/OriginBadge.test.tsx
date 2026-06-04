import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { OriginBadge } from "../OriginBadge";

/**
 * Smoke + variant coverage for OriginBadge — the new `group` variant
 * (Stream R / v3 Round 4) needs:
 *   - the visible label "via group";
 *   - `data-origin="group"` so the CSS module's tint selector matches;
 *   - an aria-label that disambiguates it from inheritance origins (the
 *     other variants read "Inherited from X", which would be a lie for
 *     a UI-only group-membership badge).
 *
 * The five inheritance variants get one regression test each so a
 * future labelFor edit keeps every kind covered exhaustively.
 */

describe("OriginBadge", () => {
  it.each([
    ["direct" as const, "task", "Inherited from task"],
    ["role" as const, "agent", "Inherited from agent"],
    ["column" as const, "column", "Inherited from column"],
    ["board" as const, "board", "Inherited from board"],
    ["space" as const, "space", "Inherited from space"],
  ])(
    "renders inheritance variant %s with label %s and aria-label %s",
    (kind, label, aria) => {
      const origin =
        kind === "direct"
          ? ({ kind } as const)
          : ({ kind, id: `${kind}-id` } as const);
      render(
        <OriginBadge origin={origin} data-testid={`badge-${kind}`} />,
      );
      const badge = screen.getByTestId(`badge-${kind}`);
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveAttribute("data-origin", kind);
      expect(badge).toHaveAttribute("aria-label", aria);
    },
  );

  it("renders the group variant with the 'via group' label", () => {
    render(
      <OriginBadge
        origin={{ kind: "group", id: "g-1" }}
        data-testid="badge-group"
      />,
    );
    const badge = screen.getByTestId("badge-group");
    expect(badge).toHaveTextContent("via group");
    expect(badge).toHaveAttribute("data-origin", "group");
    // group is UI-only — the aria-label must not pretend it sits on
    // the inheritance chain.
    expect(badge).toHaveAttribute("aria-label", "Member of prompt group");
  });

  it("renders the override star prefix when the overridden flag is set", () => {
    render(
      <OriginBadge
        origin={{ kind: "board", id: "b-1" }}
        overridden
        data-testid="badge-override"
      />,
    );
    const badge = screen.getByTestId("badge-override");
    expect(badge).toHaveAttribute("data-overridden", "true");
    expect(badge).toHaveTextContent("★");
  });

  it("applies the suppressed state via data-suppressed", () => {
    render(
      <OriginBadge
        origin={{ kind: "space", id: "s-1" }}
        suppressed
        data-testid="badge-suppressed"
      />,
    );
    expect(screen.getByTestId("badge-suppressed")).toHaveAttribute(
      "data-suppressed",
      "true",
    );
  });
});
