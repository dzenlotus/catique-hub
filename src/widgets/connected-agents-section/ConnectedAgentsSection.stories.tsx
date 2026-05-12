/**
 * Storybook — ConnectedAgentsSection (round-21).
 *
 * Stories:
 *   Loading    — query pending, skeleton rows visible.
 *   Empty      — success with 0 connected providers.
 *   Populated  — two connected providers with steady sync state.
 *   Syncing    — global sync indicator is in flight.
 *   WithError  — failing-providers payload renders the error pill.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  connectedClientsKeys,
  type ConnectedClient,
  type SyncStatus,
} from "@entities/connected-client";
import { ToastProvider } from "@app/providers/ToastProvider";

import { ConnectedAgentsSection } from "./ConnectedAgentsSection";

// ── Stub factory ──────────────────────────────────────────────────────────────

function stubProvider(overrides?: Partial<ConnectedClient>): ConnectedClient {
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

const sampleProviders: ConnectedClient[] = [
  stubProvider({
    id: "claude-code",
    displayName: "Claude Code",
  }),
  stubProvider({
    id: "cursor",
    displayName: "Cursor",
    configDir: "/Users/dev/.cursor",
    signatureFile: "/Users/dev/.cursor/settings.json",
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
  return makeBaseClient();
}

function makeSeededClient(
  providers: ConnectedClient[],
  syncStatus: SyncStatus = { state: "idle" },
): QueryClient {
  const client = makeBaseClient();
  client.setQueryData(connectedClientsKeys.list(), providers);
  client.setQueryData(connectedClientsKeys.syncStatus(), syncStatus);
  client.setQueryData(connectedClientsKeys.supported(), []);
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
  client.setQueryData(connectedClientsKeys.syncStatus(), { state: "idle" });
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

export const Loading: Story = {
  decorators: [
    (Story) => (
      <Wrapper client={makePendingClient()}>
        <Story />
      </Wrapper>
    ),
  ],
};

export const Empty: Story = {
  decorators: [
    (Story) => (
      <Wrapper client={makeSeededClient([])}>
        <Story />
      </Wrapper>
    ),
  ],
};

export const Populated: Story = {
  decorators: [
    (Story) => (
      <Wrapper client={makeSeededClient(sampleProviders)}>
        <Story />
      </Wrapper>
    ),
  ],
};

export const Syncing: Story = {
  decorators: [
    (Story) => (
      <Wrapper
        client={makeSeededClient(sampleProviders, { state: "syncing" })}
      >
        <Story />
      </Wrapper>
    ),
  ],
};

export const WithError: Story = {
  decorators: [
    (Story) => (
      <Wrapper
        client={makeSeededClient(sampleProviders, {
          state: "error",
          failingProviders: ["cursor"],
        })}
      >
        <Story />
      </Wrapper>
    ),
  ],
};

export const ListLoadFailed: Story = {
  decorators: [
    (Story) => (
      <Wrapper client={makeErrorClient("IPC channel unavailable")}>
        <Story />
      </Wrapper>
    ),
  ],
};
