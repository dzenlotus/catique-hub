import type { Meta, StoryObj } from "@storybook/react-vite";

import type { Task } from "../../model/types";
import { TaskCard } from "./TaskCard";

const baseTask: Task = {
  id: "tsk-001",
  boardId: "brd-1",
  columnId: "col-1",
  slug: "tsk-abc123",
  title: "Ship kanban widget E3.1",
  description: null,
  position: 1.0,
  roleId: null,
  stepLog: "",
  createdAt: 0n,
  updatedAt: 0n,
};

const meta = {
  title: "entities/task/TaskCard",
  component: TaskCard,
  args: {
    task: baseTask,
    attachmentsCount: 0,
  },
  argTypes: {
    isPending: { control: "boolean" },
    attachmentsCount: { control: { type: "number", min: 0, max: 9 } },
  },
} satisfies Meta<typeof TaskCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRole: Story = {
  args: { task: { ...baseTask, roleId: "anna" } },
};

export const WithAttachments: Story = {
  args: { attachmentsCount: 3 },
};

export const WithRoleAndAttachments: Story = {
  args: {
    task: { ...baseTask, roleId: "olga" },
    attachmentsCount: 2,
  },
};

export const LongTitle: Story = {
  args: {
    task: {
      ...baseTask,
      title:
        "A long task title that overflows the card width and must be truncated with an ellipsis on the right",
    },
  },
};

export const SkeletonLoading: Story = {
  args: { isPending: true },
};
