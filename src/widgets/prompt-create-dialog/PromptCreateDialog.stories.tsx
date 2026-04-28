/**
 * Storybook — PromptCreateDialog.
 *
 * PromptCreateDialog holds all state internally (no entity id prop).
 * We seed an empty QueryClient for IPC mutations that fire on submit.
 * Mutation pending/error states are deliberately skipped (IPC required).
 *
 * The "required-empty error" story documents the validation message
 * that fires when Save is pressed with empty required fields. Since
 * internal form state cannot be pre-seeded, the error is user-triggered
 * by clicking Создать with blank inputs.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PromptCreateDialog } from "./PromptCreateDialog";

// ── Client helpers ────────────────────────────────────────────────────────────

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/prompt-create-dialog/PromptCreateDialog",
  component: PromptCreateDialog,
  args: {
    isOpen: false,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof PromptCreateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** isOpen false — dialog closed. */
export const Closed: Story = {
  args: { isOpen: false },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/** isOpen true — empty form ready for input. */
export const Open: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};

/**
 * Open with required-empty validation error.
 *
 * Click «Создать» with both Название and Содержимое empty to see the
 * "Название не может быть пустым." validation message.
 */
export const OpenWithRequiredError: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient()}>
        <div>
          <p style={{ marginBottom: 8, fontSize: 12, color: "var(--color-text-secondary, #666)" }}>
            Нажмите «Создать» с пустыми полями чтобы увидеть ошибку валидации.
          </p>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
