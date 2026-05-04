/**
 * Storybook — AttachPromptDialog.
 *
 * The dialog renders comboboxes for boards, columns, tasks, roles and
 * prompts via react-query. All lists are seeded in the cache. Mutation
 * states are skipped (IPC required).
 *
 * The "Open at column cascade" story seeds boards + columns so the
 * board picker is pre-populated (the cascade combobox is enabled once
 * a board is selected — this story documents the initial open state).
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { boardsKeys } from "@entities/board";
import type { Board } from "@entities/board";
import { columnsKeys } from "@entities/column";
import type { Column } from "@entities/column";
import { tasksKeys } from "@entities/task";
import type { Task } from "@entities/task";
import { rolesKeys } from "@entities/role";
import type { Role } from "@entities/role";
import { promptsKeys } from "@entities/prompt";
import type { Prompt } from "@entities/prompt";

import { AttachPromptDialog } from "./AttachPromptDialog";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubBoard(id: string, name: string, spaceId = "spc-1"): Board {
  return { id, name, spaceId, roleId: null, position: 1, description: null, ownerRoleId: "maintainer-system", createdAt: 0n, updatedAt: 0n };
}

function stubColumn(id: string, name: string, boardId: string): Column {
  return { id, name, boardId, position: 1n, roleId: null, createdAt: 0n };
}

function stubTask(id: string, title: string, boardId: string, columnId: string): Task {
  return {
    id, boardId, columnId,
    slug: "РЗ-1",
    title,
    description: null,
    position: 1,
    roleId: null,
    stepLog: "",
    createdAt: 0n,
    updatedAt: 0n,
  };
}

function stubRole(id: string, name: string): Role {
  return { id, name, content: "", color: null, isSystem: false, createdAt: 0n, updatedAt: 0n };
}

function stubPrompt(id: string, name: string): Prompt {
  return { id, name, content: "", color: null, shortDescription: null, icon: null, tokenCount: null, createdAt: 0n, updatedAt: 0n };
}

const sampleBoards: Board[] = [
  stubBoard("b-1", "Бэклог разработки"),
  stubBoard("b-2", "Бэклог дизайна"),
];

const sampleColumns: Column[] = [
  stubColumn("col-1", "К выполнению", "b-1"),
  stubColumn("col-2", "В работе", "b-1"),
  stubColumn("col-3", "Готово", "b-1"),
];

const sampleTasks: Task[] = [
  stubTask("t-1", "Реализовать поиск", "b-1", "col-1"),
  stubTask("t-2", "Написать документацию", "b-1", "col-2"),
];

const sampleRoles: Role[] = [
  stubRole("role-1", "Архитектор системы"),
  stubRole("role-2", "Технический руководитель"),
];

const samplePrompts: Prompt[] = [
  stubPrompt("p-1", "Системный промпт разработчика"),
  stubPrompt("p-2", "Промпт для ревью кода"),
  stubPrompt("p-3", "Промпт для документации API"),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(boardsKeys.list(), sampleBoards);
  client.setQueryData(columnsKeys.list("b-1"), sampleColumns);
  client.setQueryData(columnsKeys.list("b-2"), []);
  client.setQueryData(tasksKeys.byBoard("b-1"), sampleTasks);
  client.setQueryData(tasksKeys.byBoard("b-2"), []);
  client.setQueryData(rolesKeys.list(), sampleRoles);
  client.setQueryData(promptsKeys.list(), samplePrompts);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/attach-prompt-dialog/AttachPromptDialog",
  component: AttachPromptDialog,
  args: {
    isOpen: false,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof AttachPromptDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** isOpen false — dialog closed. */
export const Closed: Story = {
  args: { isOpen: false },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Open with kind "board" selected (default). */
export const OpenAtBoard: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/**
 * Open with kind "column" (cascade: board → column).
 * The board combobox is pre-populated; selecting a board enables
 * the column combobox below it.
 */
export const OpenAtColumnCascade: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Open with kind "role" — single role combobox shown. */
export const OpenAtRole: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};
