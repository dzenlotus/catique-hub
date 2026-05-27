/**
 * RailSection — unit tests for the section scaffolding (label, add
 * trigger, loading / error / empty states).
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  it("renders an add trigger when onAdd is supplied + body has loaded", () => {
    render(
      <RailSection
        title="ROLES"
        testIdPrefix="test-rail"
        addLabel="Add role"
        onAdd={vi.fn()}
        isEmpty
      >
        {null}
      </RailSection>,
    );
    expect(screen.getByTestId("test-rail-add")).toBeInTheDocument();
  });

  it("fires onAdd when the add trigger is clicked", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <RailSection
        title="ROLES"
        testIdPrefix="test-rail"
        addLabel="Add role"
        onAdd={onAdd}
        isEmpty
      >
        {null}
      </RailSection>,
    );
    await user.click(screen.getByTestId("test-rail-add"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("hides the add trigger while loading", () => {
    render(
      <RailSection
        title="ROLES"
        testIdPrefix="test-rail"
        addLabel="Add role"
        onAdd={vi.fn()}
        isLoading
        isEmpty
      >
        {null}
      </RailSection>,
    );
    expect(screen.queryByTestId("test-rail-add")).not.toBeInTheDocument();
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
