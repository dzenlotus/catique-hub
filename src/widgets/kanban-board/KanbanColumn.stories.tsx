import type { Meta, StoryObj } from "@storybook/react-vite";
import { DndContext } from "@dnd-kit/core";

import type { Column } from "@entities/column";
import type { Task } from "@entities/task";

import { KanbanColumn } from "./KanbanColumn";

const column: Column = {
  id: "col-todo",
  boardId: "brd-1",
  name: "Todo",
  position: 1n,
  roleId: null,
  createdAt: 0n,
};

const baseTask = (id: string, title: string, position: number): Task => ({
  id,
  boardId: "brd-1",
  columnId: "col-todo",
  slug: `tsk-${id}`,
  title,
  description: null,
  position,
  roleId: null,
  createdAt: 0n,
  updatedAt: 0n,
});

const meta = {
  title: "widgets/kanban-board/KanbanColumn",
  component: KanbanColumn,
  args: {
    column,
    tasks: [
      baseTask("t1", "Migrate spaces module", 1),
      baseTask("t2", "Lock kanban DnD UX", 2),
      baseTask("t3", "Hook up MCP sidecar", 3),
    ],
  },
  decorators: [
    (Story) => (
      <DndContext>
        <div style={{ height: 480, display: "flex" }}>
          <Story />
        </div>
      </DndContext>
    ),
  ],
} satisfies Meta<typeof KanbanColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { tasks: [] },
};

export const ManyTasks: Story = {
  args: {
    tasks: Array.from({ length: 12 }, (_, i) =>
      baseTask(`t${i}`, `Task ${i + 1}`, i + 1),
    ),
  },
};
