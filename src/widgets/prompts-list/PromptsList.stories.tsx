import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { promptsKeys } from "@entities/prompt";
import type { Prompt } from "@entities/prompt";

import { PromptsList } from "./PromptsList";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubPrompt(overrides?: Partial<Prompt>): Prompt {
  return {
    id: "prm-1",
    name: "Системный промпт",
    content: "Ты опытный разработчик, помогающий командам строить продукты.",
    color: null,
    shortDescription: null,
    tokenCount: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const samplePrompts: Prompt[] = [
  stubPrompt({
    id: "prm-1",
    name: "Системный промпт агента",
    color: "#cd9b58",
    shortDescription: "Базовая личность агента",
    tokenCount: 128n,
  }),
  stubPrompt({
    id: "prm-2",
    name: "Ревьюер кода",
    color: "#3b9eff",
    shortDescription: "Строгий ревью pull-request'ов",
    tokenCount: 256n,
    content: "Проверяй код на качество, производительность и безопасность.",
  }),
  stubPrompt({
    id: "prm-3",
    name: "Технический писатель",
    color: "#32d74b",
    shortDescription: "Создаёт документацию по коду",
    tokenCount: 192n,
    content: "Пиши понятную техническую документацию.",
  }),
  stubPrompt({
    id: "prm-4",
    name: "Менеджер задач",
    color: "#ff453a",
    shortDescription: null,
    tokenCount: null,
    content: "Помогаешь приоритизировать и планировать спринт.",
  }),
  stubPrompt({
    id: "prm-5",
    name: "Аналитик данных",
    color: null,
    shortDescription: "Интерпретирует метрики продукта",
    tokenCount: 320n,
    content: "Анализируй данные и давай рекомендации.",
  }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeSeededClient(prompts: Prompt[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(promptsKeys.list(), prompts);
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
  title: "widgets/prompts-list/PromptsList",
  component: PromptsList,
  args: { onSelectPrompt: () => undefined },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PromptsList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Populated grid of colour-coded prompt cards. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(samplePrompts)}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 1200 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** No prompts — empty state with import hint. */
export const Empty: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient([])}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 1200 }}>
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
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 1200 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
