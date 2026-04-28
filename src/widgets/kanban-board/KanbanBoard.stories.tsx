import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { columnsKeys, type Column } from "@entities/column";
import { tasksKeys, type Task } from "@entities/task";
import { promptsKeys, type Prompt } from "@entities/prompt";

import { KanbanBoard } from "./KanbanBoard";

const sampleColumns: Column[] = [
  {
    id: "col-todo",
    boardId: "brd-1",
    name: "Todo",
    position: 1n,
    roleId: null,
    createdAt: 0n,
  },
  {
    id: "col-doing",
    boardId: "brd-1",
    name: "Doing",
    position: 2n,
    roleId: null,
    createdAt: 0n,
  },
  {
    id: "col-done",
    boardId: "brd-1",
    name: "Done",
    position: 3n,
    roleId: null,
    createdAt: 0n,
  },
];

const sampleTasks: Task[] = [
  {
    id: "t1",
    boardId: "brd-1",
    columnId: "col-todo",
    slug: "tsk-001",
    title: "Migrate Promptery spaces",
    description: null,
    position: 1,
    roleId: null,
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "t2",
    boardId: "brd-1",
    columnId: "col-todo",
    slug: "tsk-002",
    title: "Lock DnD UX",
    description: null,
    position: 2,
    roleId: "anna",
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "t3",
    boardId: "brd-1",
    columnId: "col-doing",
    slug: "tsk-003",
    title: "Wire MCP sidecar",
    description: null,
    position: 1,
    roleId: "olga",
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "t4",
    boardId: "brd-1",
    columnId: "col-done",
    slug: "tsk-004",
    title: "Ship E2.6 primitives",
    description: null,
    position: 1,
    roleId: null,
    createdAt: 0n,
    updatedAt: 0n,
  },
];

const samplePrompts: Prompt[] = [
  {
    id: "pmt-1",
    name: "Системный промпт",
    content: "Ты — ассистент для управления задачами.",
    color: "#6366f1",
    shortDescription: "Базовый системный промпт",
    tokenCount: 12n,
    createdAt: 0n,
    updatedAt: 0n,
  },
  {
    id: "pmt-2",
    name: "Ролевой промпт",
    content: "Ты — тимлид команды разработчиков.",
    color: null,
    shortDescription: null,
    tokenCount: null,
    createdAt: 0n,
    updatedAt: 0n,
  },
];

function makeSeededClient(columns: Column[], tasks: Task[], prompts: Prompt[] = samplePrompts): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(columnsKeys.list("brd-1"), columns);
  client.setQueryData(tasksKeys.byBoard("brd-1"), tasks);
  client.setQueryData(promptsKeys.list(), prompts);
  return client;
}

const meta = {
  title: "widgets/kanban-board/KanbanBoard",
  component: KanbanBoard,
  args: { boardId: "brd-1" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof KanbanBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleColumns, sampleTasks)}>
        <div style={{ height: "calc(100vh - 24px)", padding: "var(--space-12)" }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

export const EmptyBoard: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient([], [])}>
        <div style={{ height: 480, padding: "var(--space-12)" }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

export const EmptyColumns: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleColumns, [])}>
        <div style={{ height: 480, padding: "var(--space-12)" }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
