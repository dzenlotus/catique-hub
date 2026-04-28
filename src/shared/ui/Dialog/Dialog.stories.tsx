import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button";
import { Dialog, DialogTrigger } from "./Dialog";

const meta: Meta<typeof Dialog> = {
  title: "shared/ui/Dialog",
  component: Dialog,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <DialogTrigger>
      <Button variant="primary">Open dialog</Button>
      <Dialog title="Confirm action" description="This cannot be undone.">
        {(close) => (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button onPress={close}>Cancel</Button>
            <Button variant="primary" onPress={close}>
              Confirm
            </Button>
          </div>
        )}
      </Dialog>
    </DialogTrigger>
  ),
};

export const TitleOnly: Story = {
  render: () => (
    <DialogTrigger>
      <Button>Open</Button>
      <Dialog title="Quick note">
        <p>Press Esc or click the scrim to dismiss.</p>
      </Dialog>
    </DialogTrigger>
  ),
};
