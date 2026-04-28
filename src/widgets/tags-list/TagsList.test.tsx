import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Tag } from "@entities/tag";
import { ToastProvider } from "@app/providers/ToastProvider";

// Mock the Tauri invoke wrapper at the shared/api boundary — same
// approach as BoardsList tests, exercising the real react-query store.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { TagsList } from "./TagsList";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement): {
  client: QueryClient;
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { client, user };
}

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag-1",
    name: "frontend",
    color: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TagsList", () => {
  it("renders 3 skeleton chips while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<TagsList />);
    const skeletons = screen.getAllByTestId("tag-chip-skeleton");
    expect(skeletons).toHaveLength(3);
    expect(screen.getByTestId("tags-list-loading")).toBeInTheDocument();
  });

  it("shows the create header button always (loading state)", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<TagsList />);
    expect(screen.getByTestId("tags-list-create-button")).toBeInTheDocument();
  });

  it("shows the empty hint when the list is empty", async () => {
    invokeMock.mockResolvedValue([] satisfies Tag[]);
    renderWithClient(<TagsList />);
    await waitFor(() => {
      expect(screen.getByTestId("tags-list-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/тегов ещё нет/i)).toBeInTheDocument();
  });

  it("renders one TagChip per tag when populated", async () => {
    invokeMock.mockResolvedValue([
      makeTag({ id: "tag-1", name: "frontend" }),
      makeTag({ id: "tag-2", name: "backend" }),
      makeTag({ id: "tag-3", name: "design" }),
    ] satisfies Tag[]);
    renderWithClient(<TagsList />);
    await waitFor(() => {
      expect(screen.getByTestId("tags-list-chips")).toBeInTheDocument();
    });
    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("backend")).toBeInTheDocument();
    expect(screen.getByText("design")).toBeInTheDocument();
  });

  it("shows an inline error when the query fails", async () => {
    invokeMock.mockRejectedValue(new Error("network error"));
    renderWithClient(<TagsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  it("renders chips as interactive buttons (editor open-on-click) even when no onSelectTag is given", async () => {
    invokeMock.mockResolvedValue([
      makeTag({ id: "tag-1", name: "frontend" }),
    ] satisfies Tag[]);
    renderWithClient(<TagsList />);
    await waitFor(() => {
      expect(screen.getByTestId("tags-list-chips")).toBeInTheDocument();
    });
    // Chips are always interactive so the TagEditor can open on click.
    expect(screen.getByRole("button", { name: /frontend/i })).toBeInTheDocument();
  });

  it("calls onSelectTag with the tag id when a chip is activated", async () => {
    invokeMock.mockResolvedValue([
      makeTag({ id: "tag-pick", name: "pick-me" }),
    ] satisfies Tag[]);
    const onSelectTag = vi.fn();
    const { user } = renderWithClient(
      <TagsList onSelectTag={onSelectTag} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("tags-list-chips")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /pick-me/i }));
    expect(onSelectTag).toHaveBeenCalledWith("tag-pick");
  });

  it("renders chips with colour swatches when tags have color", async () => {
    invokeMock.mockResolvedValue([
      makeTag({ id: "tag-color", name: "urgent", color: "#ff0000" }),
    ] satisfies Tag[]);
    renderWithClient(<TagsList />);
    await waitFor(() => {
      expect(screen.getByTestId("tags-list-chips")).toBeInTheDocument();
    });
    // swatch is aria-hidden
    const swatch = document.querySelector("[aria-hidden='true']");
    expect(swatch).not.toBeNull();
  });

  it("accepts groupBy='kind' prop without error", async () => {
    invokeMock.mockResolvedValue([
      makeTag({ id: "tag-1", name: "frontend" }),
    ] satisfies Tag[]);
    renderWithClient(<TagsList groupBy="kind" />);
    await waitFor(() => {
      expect(screen.getByTestId("tags-list-chips")).toBeInTheDocument();
    });
    expect(screen.getByText("frontend")).toBeInTheDocument();
  });
});
