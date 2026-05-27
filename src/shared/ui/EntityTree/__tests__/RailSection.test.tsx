/**
 * RailSection — unit tests for the section scaffolding (label,
 * trailing slot, loading / error / empty states). RailSection itself
 * never renders an add trigger — consumers thread one in through
 * `titleTrailingNode`.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RailSection } from "../RailSection";

describe("RailSection — chrome", () => {
  it("renders the section label", () => {
    render(
      <RailSection title="ROLES" testIdPrefix="test-rail" isEmpty>
        {null}
      </RailSection>,
    );
    expect(screen.getByText("ROLES")).toBeInTheDocument();
  });

  it("stamps the testid prefix on the section root", () => {
    render(
      <RailSection title="ROLES" testIdPrefix="test-rail" isEmpty>
        {null}
      </RailSection>,
    );
    expect(screen.getByTestId("test-rail-root")).toBeInTheDocument();
  });

  it("renders trailing affordances supplied by the consumer", () => {
    render(
      <RailSection
        title="ROLES"
        testIdPrefix="test-rail"
        titleTrailingNode={
          <button type="button" data-testid="test-rail-add">
            +
          </button>
        }
        isEmpty
      >
        {null}
      </RailSection>,
    );
    expect(screen.getByTestId("test-rail-add")).toBeInTheDocument();
  });
});

describe("RailSection — body states", () => {
  it("renders the loading copy when isLoading=true", () => {
    render(
      <RailSection title="ROLES" testIdPrefix="test-rail" isLoading isEmpty>
        <li data-testid="should-not-render">item</li>
      </RailSection>,
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByTestId("should-not-render")).not.toBeInTheDocument();
  });

  it("renders the error message in an alert region", () => {
    render(
      <RailSection
        title="ROLES"
        testIdPrefix="test-rail"
        errorMessage="Failed to load"
        isEmpty
      >
        {null}
      </RailSection>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/failed to load/i);
  });

  it("renders the empty copy when isEmpty=true", () => {
    render(
      <RailSection
        title="ROLES"
        testIdPrefix="test-rail"
        emptyText="No roles yet."
        isEmpty
      >
        {null}
      </RailSection>,
    );
    expect(screen.getByText(/no roles yet/i)).toBeInTheDocument();
  });

  it("renders children inside a <ul> when isEmpty=false + no loading / error", () => {
    render(
      <RailSection
        title="ROLES"
        testIdPrefix="test-rail"
        isEmpty={false}
      >
        <li data-testid="child-row">item</li>
      </RailSection>,
    );
    expect(screen.getByTestId("child-row")).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
