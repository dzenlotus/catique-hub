import type { Meta, StoryObj } from "@storybook/react-vite";

import { Combobox, type ComboboxItem } from "./Combobox";

const PROMPTS: ComboboxItem[] = [
  { id: "p1", label: "Frontend dev brief", detail: "v3" },
  { id: "p2", label: "Backend dev brief", detail: "v2" },
  { id: "p3", label: "Tech analyst", detail: "v5" },
  { id: "p4", label: "Product analyst", detail: "v1" },
  { id: "p5", label: "Product designer", detail: "v4" },
];

const meta = {
  title: "shared/ui/Combobox",
  component: Combobox,
  parameters: { layout: "padded" },
  args: { label: "Prompt", placeholder: "Type to search…", items: PROMPTS },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    items: [],
    emptyState: "No prompts yet — create one in Prompts library.",
  },
};
