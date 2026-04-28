/**
 * Storybook — McpToolEditor.
 *
 * Mutation pending/error states deliberately skipped (IPC required).
 * Read-side states covered by react-query cache seeding.
 * The "invalid JSON" story seeds the tool with malformed schemaJson so
 * the editor renders it in the textarea — the validation error fires
 * only when the user clicks Save.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { mcpToolsKeys } from "@entities/mcp-tool";
import type { McpTool } from "@entities/mcp-tool";

import { McpToolEditor } from "./McpToolEditor";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubMcpTool(overrides?: Partial<McpTool>): McpTool {
  return {
    id: "tool-1",
    name: "Поиск в базе кода",
    description: "Выполняет семантический поиск по репозиторию проекта",
    schemaJson: JSON.stringify(
      {
        type: "object",
        properties: {
          query: { type: "string", description: "Поисковый запрос" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["query"],
      },
      null,
      2,
    ),
    color: "#f59e0b",
    position: 1,
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

function makeLoadedClient(tool: McpTool): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(mcpToolsKeys.detail(tool.id), tool);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/mcp-tool-editor/McpToolEditor",
  component: McpToolEditor,
  args: {
    toolId: null,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof McpToolEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** toolId null — dialog closed. */
export const Closed: Story = {
  args: { toolId: null },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** toolId set, no cache — skeleton / pending state. */
export const Pending: Story = {
  args: { toolId: "tool-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makePendingClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** Loaded: tool with all fields including valid JSON schema. */
export const Loaded: Story = {
  args: { toolId: "tool-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeLoadedClient(stubMcpTool())}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/**
 * Loaded with malformed schemaJson — the textarea shows the invalid JSON.
 * The "Невалидный JSON" error only appears after clicking Сохранить.
 */
export const LoadedInvalidJson: Story = {
  args: { toolId: "tool-1" },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={makeLoadedClient(
          stubMcpTool({
            schemaJson: "{ type: 'object', properties: { query: { type string } } }",
          }),
        )}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
