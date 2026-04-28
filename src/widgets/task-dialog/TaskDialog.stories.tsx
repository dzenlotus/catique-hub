/**
 * Storybook — TaskDialog.
 *
 * Mutation pending/error states are deliberately skipped here: the
 * widget uses IPC mutations that require a live Tauri backend. The
 * read-side states (Closed / Pending / Loaded / WithReports) are
 * fully covered by seeding the react-query cache.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { tasksKeys } from "@entities/task";
import type { Task } from "@entities/task";
import { agentReportsKeys } from "@entities/agent-report";
import type { AgentReport } from "@entities/agent-report";

import { TaskDialog } from "./TaskDialog";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubTask(overrides?: Partial<Task>): Task {
  return {
    id: "t-1",
    boardId: "b-1",
    columnId: "col-1",
    slug: "РЗ-1",
    title: "Разработать дизайн-систему",
    description: "Создать компонентную библиотеку на основе CSS Modules.",
    position: 1,
    roleId: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function stubReport(overrides?: Partial<AgentReport>): AgentReport {
  return {
    id: "rpt-1",
    taskId: "t-1",
    kind: "investigation",
    title: "Анализ требований к дизайн-системе",
    content: "Изучены существующие паттерны. Рекомендовано использовать CSS Modules.",
    author: "claude-opus-4",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

// ── Client helpers ────────────────────────────────────────────────────────────

function makePendingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

function makeLoadedClient(task: Task, reports: AgentReport[] = []): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(tasksKeys.detail(task.id), task);
  client.setQueryData(agentReportsKeys.byTask(task.id), reports);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/task-dialog/TaskDialog",
  component: TaskDialog,
  args: {
    taskId: null,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof TaskDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** taskId is null — dialog is closed, nothing rendered. */
export const Closed: Story = {
  args: { taskId: null },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** taskId is set but no data in cache — shows skeleton / pending state. */
export const Pending: Story = {
  args: { taskId: "t-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: task with title and description. */
export const LoadedWithDescription: Story = {
  args: { taskId: "t-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeLoadedClient(stubTask())}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: task with attached agent reports visible in the section. */
export const LoadedWithAgentReports: Story = {
  args: { taskId: "t-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={makeLoadedClient(stubTask(), [
          stubReport({ id: "rpt-1", kind: "investigation", title: "Анализ требований к дизайн-системе" }),
          stubReport({ id: "rpt-2", kind: "review", title: "Ревью архитектуры компонентной библиотеки", author: "claude-sonnet-4" }),
          stubReport({ id: "rpt-3", kind: "memo", title: "Итоги обсуждения токенов дизайна", author: null }),
        ])}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
