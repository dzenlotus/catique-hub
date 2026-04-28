import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { mcpToolsKeys } from "@entities/mcp-tool";
import type { McpTool } from "@entities/mcp-tool";

import { McpToolsList } from "./McpToolsList";

// ── Stub factories ────────────────────────────────────────────────────────────

const stubSchemaJson = JSON.stringify({
  type: "object",
  properties: {
    query: { type: "string", description: "Поисковый запрос" },
  },
  required: ["query"],
});

function stubTool(overrides?: Partial<McpTool>): McpTool {
  return {
    id: "mcp-1",
    name: "web_search",
    description: null,
    schemaJson: stubSchemaJson,
    color: null,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

const sampleTools: McpTool[] = [
  stubTool({ id: "mcp-1", name: "web_search", description: "Поиск в интернете", color: "#3b9eff", position: 1 }),
  stubTool({ id: "mcp-2", name: "read_file", description: "Чтение файла из файловой системы", color: "#cd9b58", position: 2 }),
  stubTool({ id: "mcp-3", name: "write_file", description: "Запись файла в файловую систему", color: "#32d74b", position: 3 }),
  stubTool({ id: "mcp-4", name: "run_command", description: "Выполнение shell-команды", color: "#ff453a", position: 4 }),
  stubTool({ id: "mcp-5", name: "fetch_url", description: null, color: null, position: 5 }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeSeededClient(tools: McpTool[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(mcpToolsKeys.list(), tools);
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
  title: "widgets/mcp-tools-list/McpToolsList",
  component: McpToolsList,
  args: { onSelectTool: () => undefined },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof McpToolsList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Grid of MCP tool cards with colour coding. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeSeededClient(sampleTools)}>
        <div style={{ padding: "var(--space-16, 16px)", maxWidth: 1200 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

/** No tools — empty state with CTA. */
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
