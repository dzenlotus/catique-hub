import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { rolesKeys } from "@entities/role";
import type { Role } from "@entities/role";

import { RolesList } from "./RolesList";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubRole(overrides?: Partial<Role>): Role {
  return {
    id: "role-1",
    name: "Разработчик",
    content: "Пишет и ревьюит код, участвует в планировании спринта.",
    color: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const sampleRoles: Role[] = [
  stubRole({ id: "role-1", name: "Разработчик", color: "#3b9eff" }),
  stubRole({ id: "role-2", name: "Тест-инженер", color: "#32d74b", content: "Проектирует и запускает тест-кейсы." }),
  stubRole({ id: "role-3", name: "Продакт-менеджер", color: "#cd9b58", content: "Формирует бэклог и приоритеты." }),
  stubRole({ id: "role-4", name: "Дизайнер", color: "#ff453a", content: "Создаёт пользовательские интерфейсы." }),
  stubRole({ id: "role-5", name: "Аналитик данных", color: null, content: "Исследует метрики и готовит отчёты." }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeSeededClient(roles: Role[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(rolesKeys.list(), roles);
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
  title: "widgets/roles-list/RolesList",
  component: RolesList,
  args: { onSelectRole: () => undefined },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RolesList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Grid of role cards with colour coding. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleRoles)}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 1200 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** No roles — empty state CTA. */
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
