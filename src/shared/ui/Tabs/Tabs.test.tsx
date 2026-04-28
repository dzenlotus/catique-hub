import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tab, TabList, TabPanel, Tabs } from "./Tabs";

function ThreeTabs({
  orientation = "horizontal" as const,
}: {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <Tabs orientation={orientation}>
      <TabList aria-label="sections">
        <Tab id="overview">Overview</Tab>
        <Tab id="prompts">Prompts</Tab>
        <Tab id="events">Events</Tab>
      </TabList>
      <TabPanel id="overview">overview-panel</TabPanel>
      <TabPanel id="prompts">prompts-panel</TabPanel>
      <TabPanel id="events">events-panel</TabPanel>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders tablist + tab + tabpanel ARIA roles", () => {
    render(<ThreeTabs />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("selects the first tab by default", () => {
    render(<ThreeTabs />);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("overview-panel");
  });

  it("ArrowRight moves selection in horizontal orientation", async () => {
    const user = userEvent.setup();
    render(<ThreeTabs />);
    await user.tab(); // moves focus to active tab
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Prompts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("prompts-panel");
  });

  it("ArrowDown moves selection in vertical orientation", async () => {
    const user = userEvent.setup();
    render(<ThreeTabs orientation="vertical" />);
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "Prompts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("Home jumps to the first tab, End to the last", async () => {
    const user = userEvent.setup();
    render(<ThreeTabs />);
    await user.tab();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("clicking a tab selects it and shows its panel", async () => {
    const user = userEvent.setup();
    render(<ThreeTabs />);
    await user.click(screen.getByRole("tab", { name: "Events" }));
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("events-panel");
  });
});
