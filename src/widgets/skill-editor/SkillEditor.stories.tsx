/**
 * Storybook — SkillEditor.
 *
 * Mutation pending/error states deliberately skipped (IPC required).
 * Read-side states covered by react-query cache seeding.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { skillsKeys } from "@entities/skill";
import type { Skill } from "@entities/skill";

import { SkillEditor } from "./SkillEditor";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubSkill(overrides?: Partial<Skill>): Skill {
  return {
    id: "sk-1",
    name: "Рефакторинг кода",
    description: "Улучшение структуры существующего кода без изменения поведения",
    color: "#0ea5e9",
    position: 1,
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

function makeLoadedClient(skill: Skill): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(skillsKeys.detail(skill.id), skill);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/skill-editor/SkillEditor",
  component: SkillEditor,
  args: {
    skillId: null,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof SkillEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** skillId null — dialog closed. */
export const Closed: Story = {
  args: { skillId: null },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** skillId set, no cache — skeleton / pending state. */
export const Pending: Story = {
  args: { skillId: "sk-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: skill with name, description and color. */
export const Loaded: Story = {
  args: { skillId: "sk-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeLoadedClient(stubSkill())}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};
