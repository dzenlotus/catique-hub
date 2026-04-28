import type { Meta, StoryObj } from "@storybook/react-vite";

import { ColumnHeader } from "./ColumnHeader";

const meta = {
  title: "entities/column/ColumnHeader",
  component: ColumnHeader,
  args: {
    id: "col-1",
    name: "In progress",
    taskCount: 4,
  },
  argTypes: {
    taskCount: { control: { type: "number", min: 0, max: 99 } },
  },
} satisfies Meta<typeof ColumnHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { taskCount: 0, name: "Backlog" } };
export const ManyTasks: Story = { args: { taskCount: 42 } };
export const LongName: Story = {
  args: {
    name: "A column with a name that is long enough to need truncation",
    taskCount: 7,
  },
};
