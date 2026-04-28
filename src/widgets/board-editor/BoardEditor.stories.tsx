/**
 * Storybook — BoardEditor.
 *
 * Mutation pending/error states deliberately skipped (IPC required).
 * Read-side states covered by react-query cache seeding.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { boardsKeys } from "@entities/board";
import type { Board } from "@entities/board";
import { spacesKeys } from "@entities/space";
import type { Space } from "@entities/space";

import { BoardEditor } from "./BoardEditor";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubBoard(overrides?: Partial<Board>): Board {
  return {
    id: "b-1",
    name: "Бэклог разработки",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function stubSpace(overrides?: Partial<Space>): Space {
  return {
    id: "spc-1",
    name: "Разработка",
    prefix: "РЗ",
    description: "Основное пространство",
    isDefault: true,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const sampleSpaces: Space[] = [
  stubSpace({ id: "spc-1", name: "Разработка", prefix: "РЗ", isDefault: true, position: 1 }),
  stubSpace({ id: "spc-2", name: "Маркетинг", prefix: "МК", isDefault: false, description: "Маркетинговые кампании", position: 2 }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makePendingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

function makeLoadedClient(board: Board, spaces: Space[] = sampleSpaces): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(boardsKeys.detail(board.id), board);
  client.setQueryData(spacesKeys.list(), spaces);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/board-editor/BoardEditor",
  component: BoardEditor,
  args: {
    boardId: null,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof BoardEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** boardId null — dialog closed. */
export const Closed: Story = {
  args: { boardId: null },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** boardId set, no cache — skeleton / pending state. */
export const Pending: Story = {
  args: { boardId: "b-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: board with populated name, space selection, and position. */
export const Loaded: Story = {
  args: { boardId: "b-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeLoadedClient(stubBoard())}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};
