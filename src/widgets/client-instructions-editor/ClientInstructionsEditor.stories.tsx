/**
 * Storybook — ClientInstructionsEditor.
 *
 * Stories:
 *   Closed         — clientId=null, dialog not open.
 *   Pending        — clientId set but instructions query still loading.
 *   LoadedWithContent — instructions loaded with markdown content.
 *   LoadedEmpty    — instructions loaded with empty content (new file).
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { connectedClientsKeys } from "@entities/connected-client";
import type { ClientInstructions } from "@bindings/ClientInstructions";
import { ToastProvider } from "@app/providers/ToastProvider";

import { ClientInstructionsEditor } from "./ClientInstructionsEditor";

// ── Stub factory ──────────────────────────────────────────────────────────────

function stubInstructions(
  overrides?: Partial<ClientInstructions>,
): ClientInstructions {
  return {
    clientId: "claude-code",
    filePath: "/Users/dev/.claude/CLAUDE.md",
    content: "",
    modifiedAt: 0n,
    exists: true,
    ...overrides,
  };
}

// ── Client helpers ────────────────────────────────────────────────────────────

function makeBaseClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

function makeSeededClient(instructions: ClientInstructions): QueryClient {
  const client = makeBaseClient();
  client.setQueryData(
    connectedClientsKeys.instructions(instructions.clientId),
    instructions,
  );
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
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/client-instructions-editor/ClientInstructionsEditor",
  component: ClientInstructionsEditor,
  args: {
    clientId: null,
    displayName: "Claude Code",
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof ClientInstructionsEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Dialog closed — clientId is null, nothing rendered. */
export const Closed: Story = {
  args: { clientId: null },
  decorators: [
    (Story) => (
      <Wrapper client={makeBaseClient()}>
        <Story />
      </Wrapper>
    ),
  ],
};

/**
 * Query pending — clientId is set but instructions haven't loaded yet.
 * Shows the skeleton layout with disabled footer buttons.
 */
export const Pending: Story = {
  args: { clientId: "claude-code" },
  decorators: [
    (Story) => (
      // No data seeded → query stays pending
      <Wrapper client={makeBaseClient()}>
        <Story />
      </Wrapper>
    ),
  ],
};

/** Loaded with markdown content — full editor visible. */
export const LoadedWithContent: Story = {
  args: { clientId: "claude-code" },
  decorators: [
    (Story) => (
      <Wrapper
        client={makeSeededClient(
          stubInstructions({
            content: [
              "# Claude Code global instructions",
              "",
              "You are a senior frontend engineer working inside Claude Code.",
              "",
              "## Principles",
              "",
              "- Read the surrounding code before changing architecture.",
              "- Preserve established stack and conventions.",
              "- Favor clear composition and predictable state flow.",
            ].join("\n"),
          }),
        )}
      >
        <Story />
      </Wrapper>
    ),
  ],
};

/** Loaded with empty content — textarea placeholder visible. */
export const LoadedEmpty: Story = {
  args: { clientId: "claude-code" },
  decorators: [
    (Story) => (
      <Wrapper
        client={makeSeededClient(
          stubInstructions({ content: "" }),
        )}
      >
        <Story />
      </Wrapper>
    ),
  ],
};
