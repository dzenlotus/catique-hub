import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { tagsKeys } from "@entities/tag";
import type { Tag } from "@entities/tag";

import { TagsList } from "./TagsList";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubTag(overrides?: Partial<Tag>): Tag {
  return {
    id: "tag-1",
    name: "Срочно",
    color: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const sampleTags: Tag[] = [
  stubTag({ id: "tag-1", name: "Срочно", color: "#ff453a" }),
  stubTag({ id: "tag-2", name: "В работе", color: "#3b9eff" }),
  stubTag({ id: "tag-3", name: "Готово", color: "#32d74b" }),
  stubTag({ id: "tag-4", name: "Ревью", color: "#cd9b58" }),
  stubTag({ id: "tag-5", name: "Баг", color: "#ff453a" }),
  stubTag({ id: "tag-6", name: "Улучшение", color: "#3b9eff" }),
  stubTag({ id: "tag-7", name: "Документация", color: null }),
  stubTag({ id: "tag-8", name: "Инфраструктура", color: "#32d74b" }),
  stubTag({ id: "tag-9", name: "Безопасность", color: "#ff453a" }),
  stubTag({ id: "tag-10", name: "Производительность", color: "#cd9b58" }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeSeededClient(tags: Tag[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(tagsKeys.list(), tags);
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
  title: "widgets/tags-list/TagsList",
  component: TagsList,
  args: { onSelectTag: () => undefined },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TagsList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Wrapping row of colour-coded tag chips. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleTags)}>
        <div style={{ padding: "var(--space-16, 16px)" }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** No tags — empty-state hint. */
export const Empty: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient([])}>
        <div style={{ padding: "var(--space-16, 16px)" }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** Query pending — three skeleton chips. */
export const Loading: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <div style={{ padding: "var(--space-16, 16px)" }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** Grouped by kind (single flat group, future-proof). */
export const GroupedByKind: Story = {
  args: { groupBy: "kind" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleTags)}>
        <div style={{ padding: "var(--space-16, 16px)" }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
