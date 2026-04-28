/**
 * Storybook — PromptEditor.
 *
 * Mutation pending/error states are deliberately skipped: the widget uses IPC
 * mutations that require a live Tauri backend. The read-side states (Closed /
 * Pending / Loaded variants) are covered by react-query cache seeding.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { promptsKeys } from "@entities/prompt";
import type { Prompt } from "@entities/prompt";

import { PromptEditor } from "./PromptEditor";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubPrompt(overrides?: Partial<Prompt>): Prompt {
  return {
    id: "p-1",
    name: "Системный промпт разработчика",
    content: "Ты — опытный разработчик программного обеспечения. Следуй принципам SOLID и пиши чистый, читаемый код.",
    color: "#4f46e5",
    shortDescription: "Основной промпт для задач разработки",
    tokenCount: 42n,
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

function makeLoadedClient(prompt: Prompt): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(promptsKeys.detail(prompt.id), prompt);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/prompt-editor/PromptEditor",
  component: PromptEditor,
  args: {
    promptId: null,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof PromptEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** promptId is null — dialog closed. */
export const Closed: Story = {
  args: { promptId: null },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** promptId is set but no data in cache — skeleton state. */
export const Pending: Story = {
  args: { promptId: "p-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: all fields populated — name, content, color, short description, token count. */
export const LoadedAllFields: Story = {
  args: { promptId: "p-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeLoadedClient(stubPrompt())}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: optional fields empty — no color, no short description, no token count. */
export const LoadedEmptyOptionalFields: Story = {
  args: { promptId: "p-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={makeLoadedClient(
          stubPrompt({
            color: null,
            shortDescription: null,
            tokenCount: null,
          }),
        )}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
