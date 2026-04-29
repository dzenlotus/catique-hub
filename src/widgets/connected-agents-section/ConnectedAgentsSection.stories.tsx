/**
 * Storybook — ConnectedAgentsSection.
 *
 * Stories:
 *   Loading    — query pending, skeleton cards visible.
 *   Empty      — success with 0 clients, empty message shown.
 *   Populated  — 3 clients (mix of installed/disabled/role-sync capable).
 *   WithError  — query failed, error message visible.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { connectedClientsKeys } from "@entities/connected-client";
import type { ConnectedClient } from "@entities/connected-client";
import { ToastProvider } from "@app/providers/ToastProvider";

import { ConnectedAgentsSection } from "./ConnectedAgentsSection";

// ── Stub factory ──────────────────────────────────────────────────────────────

function stubClient(overrides?: Partial<ConnectedClient>): ConnectedClient {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    configDir: "/Users/dev/.claude",
    signatureFile: "/Users/dev/.claude/settings.json",
    installed: true,
    enabled: true,
    lastSeenAt: 0n,
    supportsRoleSync: true,
    ...overrides,
  };
}

const sampleClients: ConnectedClient[] = [
  stubClient({
    id: "claude-code",
    displayName: "Claude Code",
    installed: true,
    enabled: true,
    supportsRoleSync: true,
  }),
  stubClient({
    id: "cursor",
    displayName: "Cursor",
    configDir: "/Users/dev/.cursor",
    signatureFile: "/Users/dev/.cursor/settings.json",
    installed: true,
    enabled: false,
    supportsRoleSync: false,
  }),
  stubClient({
    id: "cline",
    displayName: "Cline",
    configDir: "/Users/dev/.cline",
    signatureFile: "/Users/dev/.cline/settings.json",
    installed: false,
    enabled: false,
    supportsRoleSync: true,
  }),
];

// ── Client helpers ────────────────────────────────────────────────────────────

function makeBaseClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

function makePendingClient(): QueryClient {
  // No data set → query remains pending (never fires IPC in Storybook).
  return makeBaseClient();
}

function makeSeededClient(clients: ConnectedClient[]): QueryClient {
  const client = makeBaseClient();
  client.setQueryData(connectedClientsKeys.list(), clients);
  return client;
}

function makeErrorClient(message: string): QueryClient {
  const client = makeBaseClient();
  const cache = client.getQueryCache();
  const query = cache.build(client, {
    queryKey: connectedClientsKeys.list(),
  });
  query.setState({
    data: undefined,
    dataUpdateCount: 0,
    dataUpdatedAt: 0,
    error: new Error(message),
    errorUpdateCount: 1,
    errorUpdatedAt: Date.now(),
    fetchFailureCount: 1,
    fetchFailureReason: new Error(message),
    fetchMeta: null,
    isInvalidated: false,
    status: "error",
    fetchStatus: "idle",
  });
  return client;
}

// ── Wrapper ───────────────────────────────────────────────────────────────────

function Wrapper({
  children,
  client,
}: {
  children: React.ReactNode;
  client: QueryClient;
}): React.ReactElement {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <div style={{ maxWidth: 800, padding: "var(--space-24, 24px)" }}>
          {children}
        </div>
      </ToastProvider>
    </QueryClientProvider>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/connected-agents-section/ConnectedAgentsSection",
  component: ConnectedAgentsSection,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ConnectedAgentsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Query still loading — skeleton cards visible. */
export const Loading: Story = {
  decorators: [
    (Story) => (
      <Wrapper client={makePendingClient()}>
        <Story />
      </Wrapper>
    ),
  ],
};

/** No clients found after scanning — empty prompt. */
export const Empty: Story = {
  decorators: [
    (Story) => (
      <Wrapper client={makeSeededClient([])}>
        <Story />
      </Wrapper>
    ),
  ],
};

/** Three clients: installed+enabled, installed+disabled, not-found. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <Wrapper client={makeSeededClient(sampleClients)}>
        <Story />
      </Wrapper>
    ),
  ],
};

/** Query error — error banner shown. */
export const WithError: Story = {
  decorators: [
    (Story) => (
      <Wrapper client={makeErrorClient("IPC channel unavailable")}>
        <Story />
      </Wrapper>
    ),
  ],
};
