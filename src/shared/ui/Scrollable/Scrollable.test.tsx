/**
 * Smoke tests for the shared `<Scrollable>` primitive.
 *
 * `overlayscrollbars-react` defers initialisation to an idle frame by
 * default, but jsdom doesn't tick frames the same way a browser does.
 * The host element is rendered synchronously regardless, which is what
 * we assert on — DOM presence + attribute pass-through.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Scrollable } from "./Scrollable";

describe("Scrollable", () => {
  it("renders its children", () => {
    render(
      <Scrollable data-testid="scroll-host">
        <p>Hello world</p>
      </Scrollable>,
    );
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("forwards the data-testid to the host element", () => {
    render(
      <Scrollable data-testid="scroll-host">
        <span>content</span>
      </Scrollable>,
    );
    expect(screen.getByTestId("scroll-host")).toBeInTheDocument();
  });

  it("emits a `data-axis` attribute mirroring the axis prop (default 'y')", () => {
    render(
      <Scrollable data-testid="scroll-host">
        <span>content</span>
      </Scrollable>,
    );
    expect(screen.getByTestId("scroll-host")).toHaveAttribute("data-axis", "y");
  });

  it("emits `data-axis='x'` for horizontal scrollers", () => {
    render(
      <Scrollable axis="x" data-testid="scroll-host">
        <span>content</span>
      </Scrollable>,
    );
    expect(screen.getByTestId("scroll-host")).toHaveAttribute("data-axis", "x");
  });

  it("emits `data-axis='both'` for two-axis scrollers", () => {
    render(
      <Scrollable axis="both" data-testid="scroll-host">
        <span>content</span>
      </Scrollable>,
    );
    expect(screen.getByTestId("scroll-host")).toHaveAttribute(
      "data-axis",
      "both",
    );
  });

  it("merges the consumer-supplied className onto the host element", () => {
    render(
      <Scrollable
        className="custom-class"
        data-testid="scroll-host"
      >
        <span>content</span>
      </Scrollable>,
    );
    expect(screen.getByTestId("scroll-host")).toHaveClass("custom-class");
  });

  it("does not render a literal 'undefined' data-testid attribute when omitted", () => {
    render(
      <Scrollable>
        <span data-testid="content-marker">content</span>
      </Scrollable>,
    );
    // The host wraps the content; the inner span we tagged is what we
    // pull out so we can walk up to the host.
    const inner = screen.getByTestId("content-marker");
    let host: HTMLElement | null = inner;
    while (host && !host.hasAttribute("data-axis")) {
      host = host.parentElement;
    }
    expect(host).not.toBeNull();
    expect(host?.hasAttribute("data-testid")).toBe(false);
  });
});
