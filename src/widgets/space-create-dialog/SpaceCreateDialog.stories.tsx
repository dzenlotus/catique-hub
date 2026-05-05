/**
 * Storybook — SpaceCreateDialog.
 *
 * SpaceCreateDialog calls `useActiveSpace()` on submit to set the new
 * active space, so we wrap with `ActiveSpaceProvider`. The provider
 * reads the spaces list, so we seed it in the client.
 *
 * Mutation pending/error states deliberately skipped (IPC required).
 * The "prefix-validation-error" story simulates the validation by
 * pre-populating what the user typed — the error renders immediately
 * on first keystroke so this requires only rendering Open with an
 * invalid prefix pre-entered by the user (we can't pre-set internal
 * state from outside; the story documents the scenario visually with
 * a note).
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { spacesKeys } from "@entities/space";
import type { Space } from "@entities/space";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";

import { SpaceCreateDialog } from "./SpaceCreateDialog";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubSpace(overrides?: Partial<Space>): Space {
  return {
    id: "spc-1",
    name: "Разработка",
    prefix: "РЗ",
    description: null,
    color: null,
    icon: null,
    isDefault: true,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

// ── Client helpers ────────────────────────────────────────────────────────────

function makeClient(spaces: Space[] = []): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(spacesKeys.list(), spaces);
  return client;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/space-create-dialog/SpaceCreateDialog",
  component: SpaceCreateDialog,
  args: {
    isOpen: false,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof SpaceCreateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** isOpen false — dialog closed, nothing rendered. */
export const Closed: Story = {
  args: { isOpen: false },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient([stubSpace()])}>
        <ActiveSpaceProvider>
          <Story />
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/** isOpen true — dialog open with empty form. */
export const Open: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient([stubSpace()])}>
        <ActiveSpaceProvider>
          <Story />
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};

/**
 * Open with prefix validation error visible.
 *
 * The prefix validation fires on every keystroke inside the dialog.
 * This story documents the scenario — type an invalid prefix (e.g.
 * digits only like "123") and the inline error appears. Since internal
 * state cannot be pre-seeded, the error state is user-triggered.
 */
export const OpenWithPrefixError: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient([stubSpace()])}>
        <ActiveSpaceProvider>
          <div>
            <p style={{ marginBottom: 8, fontSize: 12, color: "var(--color-text-secondary, #666)" }}>
              Введите невалидный префикс (напр. &laquo;123&raquo;) чтобы увидеть ошибку валидации.
            </p>
            <Story />
          </div>
        </ActiveSpaceProvider>
      </QueryClientProvider>
    ),
  ],
};
