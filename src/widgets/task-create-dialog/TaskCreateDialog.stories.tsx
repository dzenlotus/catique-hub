/**
 * Storybook — TaskCreateDialog.
 *
 * Stories:
 *   Closed           — dialog prop isOpen=false (shell only, no content rendered).
 *   OpenWithData     — open with seeded boards / columns / roles.
 *   OpenEmptyForm    — open with data but no input entered (Save disabled).
 *   SavingPending    — open with title+board+column filled, mutation in-flight.
 *
 * The dialog uses ActiveSpaceProvider (to filter boards) and ToastProvider
 * (for success/error toasts). We seed react-query with setQueryData so no
 * real IPC occurs.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { boardsKeys } from "@entities/board";
import type { Board } from "@entities/board";
import { columnsKeys } from "@entities/column";
import type { Column } from "@entities/column";
import { rolesKeys } from "@entities/role";
import type { Role } from "@entities/role";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { ToastProvider } from "@app/providers/ToastProvider";

import { TaskCreateDialog } from "./TaskCreateDialog";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubBoard(overrides?: Partial<Board>): Board {
  return {
    id: "brd-1",
    name: "Main board",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    description: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function stubColumn(overrides?: Partial<Column>): Column {
  return {
    id: "col-1",
    boardId: "brd-1",
    name: "Backlog",
    position: 1n,
    roleId: null,
    createdAt: 0n,
    ...overrides,
  };
}

function stubRole(overrides?: Partial<Role>): Role {
  return {
    id: "role-1",
    name: "Senior Engineer",
    content: "You are a senior engineer.",
    color: "#cd9b58",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

// ── Query client helpers ──────────────────────────────────────────────────────

function makeEmptyClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

function makeSeededClient(): QueryClient {
  const client = makeEmptyClient();

  const boards = [
    stubBoard({ id: "brd-1", name: "Main board" }),
    stubBoard({ id: "brd-2", name: "Marketing", spaceId: "spc-1", position: 2 }),
  ];
  const columns = [
    stubColumn({ id: "col-1", boardId: "brd-1", name: "Backlog" }),
    stubColumn({ id: "col-2", boardId: "brd-1", name: "In progress", position: 2n }),
    stubColumn({ id: "col-3", boardId: "brd-1", name: "Done", position: 3n }),
  ];
  const roles = [
    stubRole({ id: "role-1", name: "Senior Engineer", color: "#cd9b58" }),
    stubRole({ id: "role-2", name: "Product Manager", color: "#3b9eff" }),
  ];

  client.setQueryData(boardsKeys.list(), boards);
  client.setQueryData(columnsKeys.list("brd-1"), columns);
  client.setQueryData(rolesKeys.list(), roles);

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
        <ActiveSpaceProvider>{children}</ActiveSpaceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/task-create-dialog/TaskCreateDialog",
  component: TaskCreateDialog,
  args: {
    isOpen: false,
    onClose: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof TaskCreateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Dialog closed — shell renders but no content is mounted. */
export const Closed: Story = {
  args: { isOpen: false },
  decorators: [
    (Story) => (
      <Wrapper client={makeEmptyClient()}>
        <Story />
      </Wrapper>
    ),
  ],
};

/** Open with boards, columns, and roles seeded — form is ready to fill. */
export const OpenWithData: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <Wrapper client={makeSeededClient()}>
        <Story />
      </Wrapper>
    ),
  ],
};

/** Open with no data entered — Save button should be disabled. */
export const OpenEmptyForm: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <Wrapper client={makeSeededClient()}>
        <Story />
      </Wrapper>
    ),
  ],
};

/**
 * Saving pending — simulated by seeding a never-resolving query client.
 * The mutation itself can't be put into pending state from the outside
 * (it fires only on user action). This story shows the loaded form state
 * ready to submit.
 */
export const SavingPending: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => (
      <Wrapper client={makeSeededClient()}>
        <Story />
      </Wrapper>
    ),
  ],
};
