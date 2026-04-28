/**
 * Storybook — WelcomeWidget.
 *
 * Both CTAs are rendered live; the create-space + locate-Promptery
 * dialogs open inline and exercise the same dialog primitive used in
 * production. We mock IPC via a per-story decorator that preempts
 * the QueryClient + the global `invoke` shim.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WelcomeWidget } from "./WelcomeWidget";

const meta = {
  title: "widgets/first-launch/WelcomeWidget",
  component: WelcomeWidget,
  parameters: { layout: "centered" },
} satisfies Meta<typeof WelcomeWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

function withQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export const Default: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={withQueryClient()}>
        <div style={{ width: 720 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
