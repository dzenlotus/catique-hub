import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button";
import { Tooltip, TooltipTrigger } from "./Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "shared/ui/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const TopPlacement: Story = {
  render: () => (
    <TooltipTrigger>
      <Button aria-label="Save">Save</Button>
      <Tooltip>Save changes (⌘S)</Tooltip>
    </TooltipTrigger>
  ),
};

export const BottomPlacement: Story = {
  render: () => (
    <TooltipTrigger>
      <Button aria-label="Delete">Delete</Button>
      <Tooltip placement="bottom">Permanently remove this row</Tooltip>
    </TooltipTrigger>
  ),
};
