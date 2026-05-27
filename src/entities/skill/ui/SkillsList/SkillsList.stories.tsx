import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { skillsKeys } from "@entities/skill";
import type { Skill } from "@entities/skill";

import { SkillsList } from "./SkillsList";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubSkill(overrides?: Partial<Skill>): Skill {
  return {
    id: "skl-1",
    name: "TypeScript",
    description: null,
    color: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const sampleSkills: Skill[] = [
  stubSkill({ id: "skl-1", name: "TypeScript", color: "#3b9eff", description: "Статически типизированный JavaScript", position: 1 }),
  stubSkill({ id: "skl-2", name: "Rust", color: "#cd9b58", description: "Системное программирование", position: 2 }),
  stubSkill({ id: "skl-3", name: "React", color: "#32d74b", description: "Библиотека для UI", position: 3 }),
  stubSkill({ id: "skl-4", name: "SQLite", color: null, description: "Встроенная реляционная БД", position: 4 }),
  stubSkill({ id: "skl-5", name: "Tauri", color: "#ff453a", description: "Десктопные приложения на Rust", position: 5 }),
  stubSkill({ id: "skl-6", name: "CSS Modules", color: null, description: null, position: 6 }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeSeededClient(skills: Skill[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(skillsKeys.list(), skills);
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
  title: "widgets/skills-list/SkillsList",
  component: SkillsList,
  args: { onSelectSkill: () => undefined },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SkillsList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Grid of skill cards with colour coding. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleSkills)}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 1200 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** No skills — empty state with CTA. */
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
