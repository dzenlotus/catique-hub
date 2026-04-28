import type { Meta, StoryObj } from "@storybook/react-vite";

import { SettingsView } from "./SettingsView";

// SettingsView has no async queries — no QueryClientProvider needed.

const meta = {
  title: "widgets/settings-view/SettingsView",
  component: SettingsView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ padding: "var(--space-16, 16px)", maxWidth: 800 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Dark theme — the default app appearance. */
export const DarkTheme: Story = {
  parameters: { backgrounds: { default: "dark" } },
  decorators: [
    (Story) => {
      document.documentElement.dataset["theme"] = "dark";
      return <Story />;
    },
  ],
};

/** Light theme toggled via the DOM attribute. */
export const LightTheme: Story = {
  parameters: { backgrounds: { default: "light" } },
  decorators: [
    (Story) => {
      document.documentElement.dataset["theme"] = "light";
      return <Story />;
    },
  ],
};

/** Default render — uses whatever theme the preview currently has. */
export const Default: Story = {};
