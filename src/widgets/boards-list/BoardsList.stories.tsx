import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { boardsKeys } from "@entities/board";
import type { Board } from "@entities/board";

import { BoardsList } from "./BoardsList";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubBoard(overrides?: Partial<Board>): Board {
  return {
    id: "brd-1",
    name: "Основная разработка",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const sampleBoards: Board[] = [
  stubBoard({ id: "brd-1", name: "Основная разработка", position: 1 }),
  stubBoard({ id: "brd-2", name: "Маркетинговые задачи", spaceId: "spc-2", position: 2 }),
  stubBoard({ id: "brd-3", name: "Релиз v1.0", position: 3, roleId: "role-pm" }),
  stubBoard({ id: "brd-4", name: "Технический долг", position: 4 }),
  stubBoard({ id: "brd-5", name: "Инфраструктура", position: 5 }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeSeededClient(boards: Board[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(boardsKeys.list(), boards);
  return client;
}

function makePendingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

function makeErrorClient(message: string): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  const cache = client.getQueryCache();
  const query = cache.build(client, { queryKey: boardsKeys.list() });
  query.setState({ status: "error", error: new Error(message) });
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/boards-list/BoardsList",
  component: BoardsList,
  args: { onSelectBoard: () => undefined },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BoardsList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Grid of boards loaded from cache. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleBoards)}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 1200 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** No boards in cache — empty state with CTA. */
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

/** Query pending — three skeleton cards rendered. */
export const LoadingSkeleton: Story = {
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

/** Query errored — inline error message + retry button. */
export const ErrorState: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeErrorClient("Не удалось подключиться к базе данных")}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 1200 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
