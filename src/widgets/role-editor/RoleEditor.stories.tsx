/**
 * Storybook — RoleEditor.
 *
 * Mutation pending/error states deliberately skipped (IPC required).
 * Read-side states covered by react-query cache seeding.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { rolesKeys } from "@entities/role";
import type { Role } from "@entities/role";

import { RoleEditor } from "./RoleEditor";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubRole(overrides?: Partial<Role>): Role {
  return {
    id: "role-1",
    name: "Архитектор системы",
    content: "Ты — опытный системный архитектор. Проектируй масштабируемые и надёжные системы, следуя принципам DDD и чистой архитектуры.",
    color: "#7c3aed",
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

function makeLoadedClient(role: Role): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(rolesKeys.detail(role.id), role);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/role-editor/RoleEditor",
  component: RoleEditor,
  args: {
    roleId: null,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof RoleEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** roleId null — dialog closed. */
export const Closed: Story = {
  args: { roleId: null },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** roleId set, no cache — skeleton / pending state. */
export const Pending: Story = {
  args: { roleId: "role-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: role with name, content and color. */
export const Loaded: Story = {
  args: { roleId: "role-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeLoadedClient(stubRole())}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Long content: role with multi-paragraph content to verify textarea scroll. */
export const LongContent: Story = {
  args: { roleId: "role-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={makeLoadedClient(
          stubRole({
            name: "Технический руководитель проекта",
            color: "#059669",
            content: [
              "Ты — технический руководитель проекта с опытом более 10 лет в разработке enterprise-систем.",
              "",
              "## Твои обязанности",
              "- Разрабатывать и поддерживать техническую дорожную карту.",
              "- Проводить архитектурные ревью и принимать финальные технические решения.",
              "- Координировать работу между командами фронтенда, бэкенда и DevOps.",
              "- Определять стандарты разработки и следить за их соблюдением.",
              "",
              "## Принципы работы",
              "- Качество кода важнее скорости доставки.",
              "- Документируй все архитектурные решения в ADR.",
              "- Избегай преждевременной оптимизации.",
              "- Предпочитай простые решения сложным.",
              "",
              "## Форматирование ответов",
              "Используй Markdown. Структурируй длинные ответы с помощью заголовков.",
              "Всегда объясняй «почему», а не только «как».",
            ].join("\n"),
          }),
        )}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
