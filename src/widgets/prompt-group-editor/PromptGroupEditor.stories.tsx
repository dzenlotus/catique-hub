/**
 * Storybook — PromptGroupEditor.
 *
 * Mutation pending/error states deliberately skipped (IPC required).
 * Read-side states covered by react-query cache seeding.
 * The MembersSection also reads `usePromptGroupMembers` (prompt id list)
 * and `usePrompts` (all prompts, for the add-combobox). Both are seeded
 * via `promptGroupsKeys.members` and `promptsKeys.list`.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { promptGroupsKeys } from "@entities/prompt-group";
import type { PromptGroup } from "@entities/prompt-group";
import { promptsKeys } from "@entities/prompt";
import type { Prompt } from "@entities/prompt";

import { PromptGroupEditor } from "./PromptGroupEditor";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubGroup(overrides?: Partial<PromptGroup>): PromptGroup {
  return {
    id: "pg-1",
    name: "Набор разработчика",
    color: "#6366f1",
    position: 1n,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function stubPrompt(id: string, name: string): Prompt {
  return {
    id,
    name,
    content: `Содержимое промпта «${name}»`,
    color: null,
    shortDescription: null,
    tokenCount: null,
    createdAt: 0n,
    updatedAt: 0n,
  };
}

const allPrompts: Prompt[] = [
  stubPrompt("p-1", "Системный промпт разработчика"),
  stubPrompt("p-2", "Промпт для ревью кода"),
  stubPrompt("p-3", "Промпт для документации"),
  stubPrompt("p-4", "Промпт для тестирования"),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makePendingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

function makeLoadedClient(
  group: PromptGroup,
  memberIds: string[],
  prompts: Prompt[] = allPrompts,
): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(promptGroupsKeys.detail(group.id), group);
  client.setQueryData(promptGroupsKeys.members(group.id), memberIds);
  client.setQueryData(promptsKeys.list(), prompts);
  // Seed individual prompt detail entries so MemberRow resolves names.
  for (const p of prompts) {
    client.setQueryData(promptsKeys.detail(p.id), p);
  }
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/prompt-group-editor/PromptGroupEditor",
  component: PromptGroupEditor,
  args: {
    groupId: null,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof PromptGroupEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** groupId null — dialog closed. */
export const Closed: Story = {
  args: { groupId: null },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: group with no member prompts — shows empty-state message. */
export const LoadedNoMembers: Story = {
  args: { groupId: "pg-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeLoadedClient(stubGroup(), [])}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: group with 3 member prompts rendered as pills. */
export const LoadedWithMembers: Story = {
  args: { groupId: "pg-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={makeLoadedClient(stubGroup(), ["p-1", "p-2", "p-3"])}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
