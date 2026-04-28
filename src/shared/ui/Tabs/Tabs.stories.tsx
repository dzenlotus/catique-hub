import type { Meta, StoryObj } from "@storybook/react-vite";

import { Tab, TabList, TabPanel, Tabs } from "./Tabs";

const meta = {
  title: "shared/ui/Tabs",
  component: Tabs,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <Tabs>
      <TabList aria-label="task sections">
        <Tab id="overview">Overview</Tab>
        <Tab id="prompts">Prompts</Tab>
        <Tab id="attachments">Attachments</Tab>
        <Tab id="events">Events</Tab>
      </TabList>
      <TabPanel id="overview">Overview content.</TabPanel>
      <TabPanel id="prompts">Prompts content.</TabPanel>
      <TabPanel id="attachments">Attachments content.</TabPanel>
      <TabPanel id="events">Events content.</TabPanel>
    </Tabs>
  ),
};

export const Vertical: Story = {
  render: () => (
    <Tabs orientation="vertical">
      <TabList aria-label="settings sections">
        <Tab id="general">General</Tab>
        <Tab id="appearance">Appearance</Tab>
        <Tab id="data">Data</Tab>
      </TabList>
      <TabPanel id="general">General settings.</TabPanel>
      <TabPanel id="appearance">Appearance settings.</TabPanel>
      <TabPanel id="data">Data settings.</TabPanel>
    </Tabs>
  ),
};
