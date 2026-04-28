import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { spacesKeys } from "@entities/space";
import type { Space } from "@entities/space";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";

import { SpacesList } from "./SpacesList";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubSpace(overrides?: Partial<Space>): Space {
  return {
    id: "spc-1",
    name: "Разработка",
    prefix: "РЗ",
    description: null,
    isDefault: false,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const multipleSpaces: Space[] = [
  stubSpace({ id: "spc-1", name: "Разработка", prefix: "РЗ", isDefault: true, description: "Основная разработка продукта", position: 1 }),
  stubSpace({ id: "spc-2", name: "Маркетинг", prefix: "МК", isDefault: false, description: "Маркетинговые кампании и контент", position: 2 }),
  stubSpace({ id: "spc-3", name: "Аналитика", prefix: "АН", isDefault: false, description: null, position: 3 }),
  stubSpace({ id: "spc-4", name: "Дизайн", prefix: "ДЗ", isDefault: false, description: "UI/UX и брендинг", position: 4 }),
];

const singleSpace: Space[] = [
  stubSpace({ id: "spc-1", name: "Основное пространство", prefix: "ОС", isDefault: true, description: "Единственное рабочее пространство", position: 1 }),
];

const defaultMidList: Space[] = [
  stubSpace({ id: "spc-1", name: "Архив", prefix: "АР", isDefault: false, position: 1 }),
  stubSpace({ id: "spc-2", name: "Основной", prefix: "ОС", isDefault: true, description: "Главное пространство команды", position: 2 }),
  stubSpace({ id: "spc-3", name: "Эксперименты", prefix: "ЭК", isDefault: false, position: 3 }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeSeededClient(spaces: Space[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(spacesKeys.list(), spaces);
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
  title: "widgets/spaces-list/SpacesList",
  component: SpacesList,
  args: { onSelectView: () => undefined },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SpacesList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Four spaces including the default. */
export const MultiSpace: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(multipleSpaces)}>
        <ActiveSpaceProvider>
          <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** Only one space exists. */
export const SingleSpace: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(singleSpace)}>
        <ActiveSpaceProvider>
          <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** isDefault marker visible on a mid-list entry. */
export const WithDefaultMarker: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(defaultMidList)}>
        <ActiveSpaceProvider>
          <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** Query pending — loading state. */
export const Loading: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <ActiveSpaceProvider>
          <div style={{ padding: "var(--space-16, 16px)", maxWidth: 900 }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};
