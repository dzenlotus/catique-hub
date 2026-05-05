import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Space } from "@entities/space";
import { ActiveSpaceProvider } from "@app/providers/ActiveSpaceProvider";
import { LocalStorageStore, stringCodec } from "@shared/storage";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { SpaceCreateDialog } from "./SpaceCreateDialog";

const activeSpaceStore = new LocalStorageStore<string>({
  key: "catique:activeSpaceId",
  codec: stringCodec,
});

const invokeMock = vi.mocked(invoke);

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "spc-1",
    name: "My Space",
    prefix: "my",
    description: null,
    color: null,
    icon: null,
    isDefault: false,
    position: 1,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderWithProviders(
  ui: ReactElement,
): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  // ActiveSpaceProvider calls useSpaces() on mount — stub it to a pending promise
  // to avoid the list_spaces IPC call interfering with dialog tests.
  render(
    <QueryClientProvider client={client}>
      <ActiveSpaceProvider>{ui}</ActiveSpaceProvider>
    </QueryClientProvider>,
  );
  return { user };
}

beforeEach(() => {
  invokeMock.mockReset();
  // Default: spaces query never resolves (keeps provider quiet).
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "list_spaces") return new Promise(() => {});
    return Promise.resolve(undefined);
  });
  activeSpaceStore.remove();
});

afterEach(() => {
  vi.restoreAllMocks();
  activeSpaceStore.remove();
});

describe("SpaceCreateDialog", () => {
  it("renders form fields when open", () => {
    renderWithProviders(<SpaceCreateDialog isOpen onClose={() => undefined} />);
    expect(screen.getByTestId("space-create-dialog-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("space-create-dialog-prefix-input")).toBeInTheDocument();
    // audit-#13: description field is no longer exposed in the form.
    expect(
      screen.queryByTestId("space-create-dialog-description-input"),
    ).not.toBeInTheDocument();
  });

  it("Save button is disabled when required fields are empty", () => {
    renderWithProviders(<SpaceCreateDialog isOpen onClose={() => undefined} />);
    expect(screen.getByTestId("space-create-dialog-save")).toBeDisabled();
  });

  it("Save button is disabled when only name is filled", async () => {
    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(screen.getByTestId("space-create-dialog-name-input"), "Alpha");
    expect(screen.getByTestId("space-create-dialog-save")).toBeDisabled();
  });

  it("Save button is disabled when only prefix is filled", async () => {
    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(screen.getByTestId("space-create-dialog-prefix-input"), "alp");
    expect(screen.getByTestId("space-create-dialog-save")).toBeDisabled();
  });

  it("Save button is disabled when prefix is invalid", async () => {
    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(screen.getByTestId("space-create-dialog-name-input"), "Alpha");
    await user.type(screen.getByTestId("space-create-dialog-prefix-input"), "-bad");
    expect(screen.getByTestId("space-create-dialog-save")).toBeDisabled();
  });

  it("shows prefix validation error when prefix is invalid", async () => {
    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(screen.getByTestId("space-create-dialog-prefix-input"), "-bad");
    expect(
      screen.getByTestId("space-create-dialog-prefix-error"),
    ).toBeInTheDocument();
  });

  it("clears prefix error when corrected to valid value", async () => {
    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={() => undefined} />,
    );
    const prefixInput = screen.getByTestId("space-create-dialog-prefix-input");
    await user.type(prefixInput, "-bad");
    expect(screen.getByTestId("space-create-dialog-prefix-error")).toBeInTheDocument();

    // Clear and type a valid prefix
    await user.clear(prefixInput);
    await user.type(prefixInput, "good");
    expect(
      screen.queryByTestId("space-create-dialog-prefix-error"),
    ).not.toBeInTheDocument();
  });

  it("Save button becomes enabled when required fields are valid", async () => {
    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(screen.getByTestId("space-create-dialog-name-input"), "Alpha");
    await user.type(screen.getByTestId("space-create-dialog-prefix-input"), "alp");
    expect(screen.getByTestId("space-create-dialog-save")).not.toBeDisabled();
  });

  it("calls create_space with required payload only (no optional)", async () => {
    const newSpace = makeSpace({ id: "spc-new", name: "Alpha", prefix: "alp" });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_spaces") return new Promise(() => {});
      if (cmd === "create_space") return Promise.resolve(newSpace);
      return Promise.resolve(undefined);
    });

    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={onClose} onCreated={onCreated} />,
    );

    await user.type(screen.getByTestId("space-create-dialog-name-input"), "Alpha");
    await user.type(screen.getByTestId("space-create-dialog-prefix-input"), "alp");
    await user.click(screen.getByTestId("space-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith(newSpace);

    const createCall = invokeMock.mock.calls.find(([cmd]) => cmd === "create_space");
    expect(createCall?.[1]).toMatchObject({ name: "Alpha", prefix: "alp" });
    expect(createCall?.[1]).not.toHaveProperty("description");
  });

  // audit-#13: the description field was removed from the form (the
  // backing column stays). The "fills description" test was retired
  // along with the input.

  it("sets active space id on success", async () => {
    const newSpace = makeSpace({ id: "spc-created" });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_spaces") return new Promise(() => {});
      if (cmd === "create_space") return Promise.resolve(newSpace);
      return Promise.resolve(undefined);
    });

    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(screen.getByTestId("space-create-dialog-name-input"), "Alpha");
    await user.type(screen.getByTestId("space-create-dialog-prefix-input"), "alp");
    await user.click(screen.getByTestId("space-create-dialog-save"));

    await waitFor(() => {
      expect(activeSpaceStore.get()).toBe("spc-created");
    });
  });

  it("shows inline error on mutation failure", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_spaces") return new Promise(() => {});
      return Promise.reject(new Error("сбой базы данных"));
    });

    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(screen.getByTestId("space-create-dialog-name-input"), "Alpha");
    await user.type(screen.getByTestId("space-create-dialog-prefix-input"), "alp");
    await user.click(screen.getByTestId("space-create-dialog-save"));

    await waitFor(() => {
      expect(screen.getByTestId("space-create-dialog-error")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("Cancel closes without calling the mutation", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <SpaceCreateDialog isOpen onClose={onClose} />,
    );

    await user.click(screen.getByTestId("space-create-dialog-cancel"));

    expect(onClose).toHaveBeenCalled();
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_space",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("does not render content when isOpen is false", () => {
    renderWithProviders(
      <SpaceCreateDialog isOpen={false} onClose={() => undefined} />,
    );
    expect(screen.queryByTestId("space-create-dialog-name-input")).toBeNull();
  });
});
