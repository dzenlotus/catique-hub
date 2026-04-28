/**
 * Storybook — TagEditor.
 *
 * Mutation pending/error states deliberately skipped (IPC required).
 * Read-side states covered by react-query cache seeding.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { tagsKeys } from "@entities/tag";
import type { Tag } from "@entities/tag";

import { TagEditor } from "./TagEditor";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubTag(overrides?: Partial<Tag>): Tag {
  return {
    id: "tag-1",
    name: "Срочно",
    color: "#dc2626",
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

function makeLoadedClient(tag: Tag): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(tagsKeys.detail(tag.id), tag);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/tag-editor/TagEditor",
  component: TagEditor,
  args: {
    tagId: null,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof TagEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** tagId null — dialog closed. */
export const Closed: Story = {
  args: { tagId: null },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** tagId set, no cache — skeleton / pending state. */
export const Pending: Story = {
  args: { tagId: "tag-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: tag with name and color. */
export const LoadedWithColor: Story = {
  args: { tagId: "tag-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeLoadedClient(stubTag())}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: tag with name but no color set. */
export const LoadedWithoutColor: Story = {
  args: { tagId: "tag-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={makeLoadedClient(stubTag({ color: null, name: "Уточнить" }))}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
