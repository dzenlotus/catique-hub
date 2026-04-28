import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { agentReportsKeys } from "@entities/agent-report";
import type { AgentReport } from "@entities/agent-report";

import { AgentReportsList } from "./AgentReportsList";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubReport(overrides?: Partial<AgentReport>): AgentReport {
  return {
    id: "rpt-1",
    taskId: "t-1",
    kind: "investigation",
    title: "Анализ причины падения производительности",
    content: "Детальный отчёт о профилировании узких мест в API.",
    author: "claude-opus-4",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const sampleReports: AgentReport[] = [
  stubReport({
    id: "rpt-1",
    kind: "investigation",
    title: "Анализ причины падения производительности",
    author: "claude-opus-4",
  }),
  stubReport({
    id: "rpt-2",
    kind: "review",
    title: "Ревью архитектуры модуля импорта",
    author: "claude-sonnet-4",
    content: "Код модуля хорошо структурирован, рекомендации: …",
  }),
  stubReport({
    id: "rpt-3",
    kind: "memo",
    title: "Итоги спринта 12",
    author: null,
    content: "Краткое резюме выполненных задач и открытых рисков.",
  }),
  stubReport({
    id: "rpt-4",
    taskId: "t-2",
    kind: "investigation",
    title: "Исследование утечки памяти в WebSocket-соединении",
    author: "claude-haiku-3",
  }),
  stubReport({
    id: "rpt-5",
    kind: "review",
    title: "Ревью миграции базы данных v3→v4",
    author: "claude-opus-4",
    content: "Проверка корректности всех ALTER TABLE и индексов.",
  }),
];

const taskOneReports: AgentReport[] = sampleReports.filter((r) => r.taskId === "t-1");

// ── Client helpers ────────────────────────────────────────────────────────────

function makeSeededClient(reports: AgentReport[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(agentReportsKeys.list(), reports);
  return client;
}

function makeSeededClientWithTask(reports: AgentReport[], taskId: string): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(agentReportsKeys.list(), reports);
  client.setQueryData(agentReportsKeys.byTask(taskId), reports);
  return client;
}

function makePendingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/agent-reports-list/AgentReportsList",
  component: AgentReportsList,
  args: { onSelectReport: () => undefined },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AgentReportsList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Mixed kinds: investigation, review, memo. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleReports)}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** No reports — empty state. */
export const Empty: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient([])}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** Query pending — three skeleton cards. */
export const Loading: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** Filtered by taskId — shows only reports for task t-1. */
export const FilteredByTask: Story = {
  args: { taskId: "t-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClientWithTask(taskOneReports, "t-1")}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** taskId set but no matching reports. */
export const FilteredByTaskEmpty: Story = {
  args: { taskId: "t-999" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClientWithTask([], "t-999")}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
