/**
 * RoleMemorySection — component tests (ctq-137 / MEM-S2).
 *
 * Mocks `@shared/api`'s `invoke` so every IPC call routed through
 * `entities/role-note/api` resolves with a deterministic payload. Tests
 * exercise the real react-query store and the real filter hook.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { ToastProvider } from "@app/providers/ToastProvider";
import type { RoleNote } from "@entities/role-note";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";

import { RoleMemorySection } from "./RoleMemorySection";

const invokeMock = vi.mocked(invoke);

function renderSection(roleId: string = "role-1"): {
  client: QueryClient;
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RoleMemorySection roleId={roleId} />
      </ToastProvider>
    </QueryClientProvider>
  );
  render(ui);
  return { client, user };
}

function makeNote(overrides: Partial<RoleNote> = {}): RoleNote {
  return {
    id: "note-1",
    roleId: "role-1",
    sourceTaskId: null,
    body: "Always run pnpm lint before commit.",
    tags: ["lint"],
    priority: 0n,
    pinned: false,
    authoredBy: "user",
    createdAt: BigInt(Date.now() - 60_000),
    updatedAt: BigInt(Date.now() - 60_000),
    ...overrides,
  };
}

// Route invoke calls by command name so each test can drive the
// underlying handlers independently.
type Handlers = Partial<{
  list_role_notes: (args: { roleId: string }) => RoleNote[] | Promise<RoleNote[]>;
  list_role_note_tags: (args: { roleId: string }) =>
    | { tag: string; count: number }[]
    | Promise<{ tag: string; count: number }[]>;
  add_role_note: (args: Record<string, unknown>) => RoleNote | Promise<RoleNote>;
  update_role_note: (
    args: Record<string, unknown>,
  ) => RoleNote | Promise<RoleNote>;
  delete_role_note: (args: { id: string }) => void | Promise<void>;
}>;

function bindInvoke(handlers: Handlers): void {
  invokeMock.mockImplementation(
    async (command: string, args?: Record<string, unknown>) => {
      const handler = (handlers as Record<string, unknown>)[command];
      if (typeof handler !== "function") {
        throw new Error(`Unhandled invoke: ${command}`);
      }
      return (handler as (a: unknown) => unknown)(args ?? {}) as never;
    },
  );
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RoleMemorySection", () => {
  it("renders the empty state when zero notes", async () => {
    bindInvoke({
      list_role_notes: () => [],
      list_role_note_tags: () => [],
    });
    renderSection();
    await waitFor(() => {
      expect(
        screen.getByTestId("role-memory-section-empty"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it("renders one row per note with body preview, tags, priority, author", async () => {
    bindInvoke({
      list_role_notes: () => [
        makeNote({
          id: "n1",
          body: "Prefer kebab-case in file names.",
          tags: ["style", "naming"],
          priority: 5n,
          authoredBy: "agent",
        }),
        makeNote({
          id: "n2",
          body: "Run pnpm tokens:build after editing tokens.json.",
          tags: ["tokens"],
          priority: 2n,
          authoredBy: "user",
        }),
      ],
      list_role_note_tags: () => [
        { tag: "style", count: 1 },
        { tag: "naming", count: 1 },
        { tag: "tokens", count: 1 },
      ],
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("role-memory-section-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("role-memory-note-n1")).toBeInTheDocument();
    expect(screen.getByTestId("role-memory-note-n2")).toBeInTheDocument();
    expect(screen.getByText(/prefer kebab-case/i)).toBeInTheDocument();
    expect(screen.getByText(/tokens:build/i)).toBeInTheDocument();
    // Author badges + priority pills.
    expect(screen.getByTestId("role-memory-note-n1-author")).toHaveTextContent(
      /agent/i,
    );
    expect(screen.getByTestId("role-memory-note-n2-author")).toHaveTextContent(
      /user/i,
    );
    expect(screen.getByTestId("role-memory-note-n1-priority")).toHaveTextContent(
      "P5",
    );
    expect(screen.getByTestId("role-memory-note-n1-tag-style")).toBeInTheDocument();
  });

  it("pin toggle calls update_role_note with pinned: true", async () => {
    const updateSpy = vi.fn((_args: Record<string, unknown>) =>
      makeNote({ pinned: true }),
    );
    bindInvoke({
      list_role_notes: () => [makeNote({ id: "n1", pinned: false })],
      list_role_note_tags: () => [],
      update_role_note: (args) => updateSpy(args),
    });
    const { user } = renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("role-memory-note-n1")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("role-memory-note-n1-pin"));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ id: "n1", pinned: true });
    });
  });

  it("clicking a tag chip narrows the visible list", async () => {
    bindInvoke({
      list_role_notes: () => [
        makeNote({ id: "n1", body: "alpha body", tags: ["style"] }),
        makeNote({ id: "n2", body: "beta body", tags: ["tokens"] }),
      ],
      list_role_note_tags: () => [
        { tag: "style", count: 1 },
        { tag: "tokens", count: 1 },
      ],
    });
    const { user } = renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("role-memory-section-list")).toBeInTheDocument();
    });
    await user.click(
      screen.getByTestId("role-memory-section-tag-chip-style"),
    );
    await waitFor(() => {
      expect(screen.getByTestId("role-memory-note-n1")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("role-memory-note-n2")).not.toBeInTheDocument();
  });

  it("search input narrows by body substring (debounced)", async () => {
    bindInvoke({
      list_role_notes: () => [
        makeNote({ id: "n1", body: "Always lint" }),
        makeNote({ id: "n2", body: "Run migrations" }),
      ],
      list_role_note_tags: () => [],
    });
    const { user } = renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("role-memory-section-list")).toBeInTheDocument();
    });
    const input = screen.getByTestId("role-memory-section-search");
    await user.type(input, "migrations");
    // Debounce is 250ms — `findByTestId` polls up to ~1s.
    await waitFor(
      () => {
        expect(screen.getByTestId("role-memory-note-n2")).toBeInTheDocument();
        expect(
          screen.queryByTestId("role-memory-note-n1"),
        ).not.toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });

  it("add-note flow: open form → fill body + tag → submit → new row", async () => {
    let stored: RoleNote[] = [];
    bindInvoke({
      list_role_notes: () => stored,
      list_role_note_tags: () => [],
      add_role_note: (args) => {
        const note: RoleNote = makeNote({
          id: "n-new",
          body: args.body as string,
          tags: args.tags as string[],
          authoredBy: "user",
        });
        stored = [...stored, note];
        return note;
      },
    });
    const { user } = renderSection();
    await waitFor(() => {
      expect(
        screen.getByTestId("role-memory-section-add-button"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("role-memory-section-add-button"));
    await user.type(
      screen.getByTestId("role-memory-add-body-input"),
      "Use semantic tokens, never raw hex.",
    );
    await user.type(
      screen.getByTestId("role-memory-add-tags-input"),
      "style, tokens",
    );
    await user.click(screen.getByTestId("role-memory-add-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("role-memory-note-n-new")).toBeInTheDocument();
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "add_role_note",
      expect.objectContaining({
        roleId: "role-1",
        body: "Use semantic tokens, never raw hex.",
        tags: ["style", "tokens"],
        authoredBy: "user",
      }),
    );
  });

  it("edit flow: click edit → form prefills → submit → row updates", async () => {
    let note = makeNote({ id: "n1", body: "Initial body", tags: ["alpha"] });
    bindInvoke({
      list_role_notes: () => [note],
      list_role_note_tags: () => [{ tag: "alpha", count: 1 }],
      update_role_note: (args) => {
        note = { ...note, ...(args as Partial<RoleNote>) };
        return note;
      },
    });
    const { user } = renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("role-memory-note-n1")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("role-memory-note-n1-edit"));
    const bodyInput = screen.getByTestId(
      "role-memory-edit-n1-body-input",
    ) as HTMLTextAreaElement;
    expect(bodyInput.value).toBe("Initial body");
    await user.clear(bodyInput);
    await user.type(bodyInput, "Updated body");
    await user.click(screen.getByTestId("role-memory-edit-n1-submit"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_role_note",
        expect.objectContaining({ id: "n1", body: "Updated body" }),
      );
    });
  });

  it("delete flow: click delete → row removed", async () => {
    let stored: RoleNote[] = [makeNote({ id: "n1" })];
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    bindInvoke({
      list_role_notes: () => stored,
      list_role_note_tags: () => [],
      delete_role_note: ({ id }) => {
        stored = stored.filter((n) => n.id !== id);
      },
    });
    const { user } = renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("role-memory-note-n1")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("role-memory-note-n1-delete"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_role_note", { id: "n1" });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("role-memory-note-n1")).not.toBeInTheDocument();
    });
    confirmSpy.mockRestore();
  });
});
