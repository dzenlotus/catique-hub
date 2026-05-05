/**
 * Storybook — TopBar.
 *
 * Stories:
 *   AtBoardsRoot    — root /boards route, no breadcrumb.
 *   AtBoardDetail   — /boards/:boardId, board name breadcrumb visible.
 *   AtTaskDetail    — /tasks/:taskId, task title breadcrumb visible.
 *
 * Uses wouter memoryLocation for static route matching so breadcrumb
 * helpers (useRoute) behave as on the real route.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { boardsKeys } from "@entities/board";
import type { Board } from "@entities/board";
import { tasksKeys } from "@entities/task";
import type { Task } from "@entities/task";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { ToastProvider } from "@app/providers/ToastProvider";
import { spacesKeys } from "@entities/space";
import type { Space } from "@entities/space";

import { TopBar } from "./TopBar";

// ── Stub factories ────────────────────────────────────────────────────────────

function stubBoard(overrides?: Partial<Board>): Board {
  return {
    id: "brd-1",
    name: "Main board",
    spaceId: "spc-1",
    roleId: null,
    position: 1,
    description: null,
    color: null,
    icon: null,
    isDefault: false,
    ownerRoleId: "maintainer-system",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function stubTask(overrides?: Partial<Task>): Task {
  return {
    id: "t-1",
    boardId: "brd-1",
    columnId: "col-1",
    slug: "CTQ-1",
    title: "Design the token system",
    description: null,
    position: 1,
    roleId: null,
    stepLog: "",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function stubSpace(overrides?: Partial<Space>): Space {
  return {
    id: "spc-1",
    name: "Dev",
    prefix: "CTQ",
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

// ── Router helper ─────────────────────────────────────────────────────────────

function StoryRouter({
  path = "/",
  children,
}: {
  path?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { hook } = memoryLocation({ path, static: true });
  return <Router hook={hook}>{children}</Router>;
}

// ── Query client helpers ──────────────────────────────────────────────────────

function makeBaseClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
}

// ── Wrapper ───────────────────────────────────────────────────────────────────

function Wrapper({
  children,
  client,
  path = "/",
}: {
  children: React.ReactNode;
  client: QueryClient;
  path?: string;
}): React.ReactElement {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ActiveSpaceProvider>
          <StoryRouter path={path}>{children}</StoryRouter>
        </ActiveSpaceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/top-bar/TopBar",
  component: TopBar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Root boards view — search + CTA + icon buttons, no breadcrumb. */
export const AtBoardsRoot: Story = {
  decorators: [
    (Story) => {
      const client = makeBaseClient();
      client.setQueryData(spacesKeys.list(), [stubSpace()]);
      return (
        <Wrapper client={client} path="/">
          <Story />
        </Wrapper>
      );
    },
  ],
};

/** Board detail route — breadcrumb shows the board name. */
export const AtBoardDetail: Story = {
  decorators: [
    (Story) => {
      const board = stubBoard({ id: "brd-1", name: "Main board" });
      const client = makeBaseClient();
      client.setQueryData(boardsKeys.list(), [board]);
      client.setQueryData(boardsKeys.detail("brd-1"), board);
      client.setQueryData(spacesKeys.list(), [stubSpace()]);
      return (
        <Wrapper client={client} path="/boards/brd-1">
          <Story />
        </Wrapper>
      );
    },
  ],
};

/** Task detail route — breadcrumb shows the task title. */
export const AtTaskDetail: Story = {
  decorators: [
    (Story) => {
      const task = stubTask({ id: "t-1", title: "Design the token system" });
      const client = makeBaseClient();
      client.setQueryData(tasksKeys.detail("t-1"), task);
      client.setQueryData(spacesKeys.list(), [stubSpace()]);
      return (
        <Wrapper client={client} path="/tasks/t-1">
          <Story />
        </Wrapper>
      );
    },
  ],
};
