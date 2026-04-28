import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { spacesKeys } from "@entities/space";
import type { Space } from "@entities/space";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";

import { Sidebar } from "./Sidebar";

// ── Stub factories ────────────────────────────────────────────────────────────

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
  stubSpace({ id: "spc-3", name: "Аналитика", prefix: "АН", isDefault: false, description: null, position: 3 }),
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

/** Never resolves — sidebar shows the space-switcher skeleton. */
function makePendingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

function makeErrorClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  const cache = client.getQueryCache();
  const query = cache.build(client, { queryKey: spacesKeys.list() });
  query.setState({ status: "error", error: new Error("Сеть недоступна") });
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/sidebar/Sidebar",
  component: Sidebar,
  args: {
    activeView: "boards" as const,
    onSelectView: () => undefined,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Boards nav item active, multiple spaces loaded. */
export const DefaultBoardsActive: Story = {
  args: { activeView: "boards" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleSpaces)}>
        <ActiveSpaceProvider>
          <div style={{ display: "flex", height: "100vh" }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** Prompts nav item highlighted. */
export const PromptsViewActive: Story = {
  args: { activeView: "prompts" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleSpaces)}>
        <ActiveSpaceProvider>
          <div style={{ display: "flex", height: "100vh" }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** No spaces in cache — switcher is suppressed. */
export const NoSpaces: Story = {
  args: { activeView: "boards" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient([])}>
        <ActiveSpaceProvider>
          <div style={{ display: "flex", height: "100vh" }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** Spaces query never resolves — switcher shows skeleton. */
export const LoadingSpaces: Story = {
  args: { activeView: "boards" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <ActiveSpaceProvider>
          <div style={{ display: "flex", height: "100vh" }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** Spaces query errored — sidebar shows error state in switcher. */
export const ErrorLoadingSpaces: Story = {
  args: { activeView: "boards" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeErrorClient()}>
        <ActiveSpaceProvider>
          <div style={{ display: "flex", height: "100vh" }}>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** Dark theme via DOM attribute. */
export const DarkTheme: Story = {
  args: { activeView: "boards" },
  decorators: [
    (Story) => {
      document.documentElement.dataset["theme"] = "dark";
      return (
        <QueryClientProvider client={makeSeededClient(sampleSpaces)}>
          <ActiveSpaceProvider>
            <div style={{ display: "flex", height: "100vh" }}>
              <Story />
            </div>
          </ActiveSpaceProvider>
        </QueryClientProvider>
      );
    },
  ],
};

/** Light theme via DOM attribute. */
export const LightTheme: Story = {
  args: { activeView: "boards" },
  decorators: [
    (Story) => {
      document.documentElement.dataset["theme"] = "light";
      return (
        <QueryClientProvider client={makeSeededClient(sampleSpaces)}>
          <ActiveSpaceProvider>
            <div style={{ display: "flex", height: "100vh" }}>
              <Story />
            </div>
          </ActiveSpaceProvider>
        </QueryClientProvider>
      );
    },
  ],
};
