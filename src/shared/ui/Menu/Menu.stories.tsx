import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button";
import { Menu, MenuItem, MenuTrigger, Separator } from "./Menu";

const meta = {
  title: "shared/ui/Menu",
  component: Menu,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RowActions: Story = {
  render: () => (
    <MenuTrigger>
      <Button>Card actions</Button>
      <Menu aria-label="card actions">
        <MenuItem id="open">Open</MenuItem>
        <MenuItem id="rename">Rename</MenuItem>
        <MenuItem id="duplicate">Duplicate</MenuItem>
        <Separator />
        <MenuItem id="delete" variant="danger">
          Delete
        </MenuItem>
      </Menu>
    </MenuTrigger>
  ),
};

export const WithDisabled: Story = {
  render: () => (
    <MenuTrigger>
      <Button>Menu</Button>
      <Menu aria-label="menu" disabledKeys={["paste"]}>
        <MenuItem id="cut">Cut</MenuItem>
        <MenuItem id="copy">Copy</MenuItem>
        <MenuItem id="paste">Paste (disabled)</MenuItem>
      </Menu>
    </MenuTrigger>
  ),
};
