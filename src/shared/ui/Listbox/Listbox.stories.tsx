import type { Meta, StoryObj } from "@storybook/react-vite";

import { Listbox, ListboxItem } from "./Listbox";

const meta = {
  title: "shared/ui/Listbox",
  component: Listbox,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Listbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleSelect: Story = {
  render: () => (
    <Listbox aria-label="role">
      <ListboxItem id="dev">Frontend developer</ListboxItem>
      <ListboxItem id="ana">Tech analyst</ListboxItem>
      <ListboxItem id="des">Product designer</ListboxItem>
    </Listbox>
  ),
};

export const MultiSelect: Story = {
  render: () => (
    <Listbox aria-label="tags" selectionMode="multiple">
      <ListboxItem id="bug">bug</ListboxItem>
      <ListboxItem id="feature">feature</ListboxItem>
      <ListboxItem id="design">design</ListboxItem>
      <ListboxItem id="security">security</ListboxItem>
    </Listbox>
  ),
};
