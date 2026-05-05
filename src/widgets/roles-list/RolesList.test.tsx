import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Role } from "@entities/role";
import { ToastProvider } from "@app/providers/ToastProvider";

// Mock the Tauri invoke wrapper at the shared/api boundary — this is
// the single place IPC traffic crosses, so all four states (loading,
// error, empty, populated) can be driven from here. We avoid mocking
// @entities/role itself to keep the test exercising the real react-query
// store.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { RolesList } from "./RolesList";

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

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-1",
    name: "Senior Engineer",
    content: "Architecture ownership.",
    color: null,
    isSystem: false,
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

describe("RolesList", () => {
  it("renders 3 skeleton cards while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<RolesList />);
    const skeletons = screen.getAllByTestId("role-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("shows the create header button always (loading state)", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<RolesList />);
    expect(screen.getByTestId("roles-list-create-button")).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", async () => {
    invokeMock.mockResolvedValue([] satisfies Role[]);
    renderWithClient(<RolesList />);
    await waitFor(() => {
      expect(screen.getByTestId("roles-list-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/no cats yet/i)).toBeInTheDocument();
  });

  it("renders one RoleCard per role when populated", async () => {
    invokeMock.mockResolvedValue([
      makeRole({ id: "role-1", name: "Product Manager" }),
      makeRole({ id: "role-2", name: "Tech Lead" }),
      makeRole({ id: "role-3", name: "Designer" }),
    ] satisfies Role[]);
    renderWithClient(<RolesList />);
    await waitFor(() => {
      expect(screen.getByTestId("roles-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("Product Manager")).toBeInTheDocument();
    expect(screen.getByText("Tech Lead")).toBeInTheDocument();
    expect(screen.getByText("Designer")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    invokeMock.mockRejectedValue(new Error("transport down"));
    renderWithClient(<RolesList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls onSelectRole with the role id when a card is activated", async () => {
    invokeMock.mockResolvedValue([
      makeRole({ id: "role-pick", name: "Pick me" }),
    ] satisfies Role[]);
    const onSelectRole = vi.fn();
    const { user } = renderWithClient(
      <RolesList onSelectRole={onSelectRole} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("roles-list-grid")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Pick me"));
    expect(onSelectRole).toHaveBeenCalledWith("role-pick");
  });

  it("renders the loading grid container while pending", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<RolesList />);
    expect(screen.getByTestId("roles-list-loading")).toBeInTheDocument();
  });
});
