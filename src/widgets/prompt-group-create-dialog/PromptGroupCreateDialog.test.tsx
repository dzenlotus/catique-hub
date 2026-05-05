import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { PromptGroup } from "@entities/prompt-group";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { PromptGroupCreateDialog } from "./PromptGroupCreateDialog";

const invokeMock = vi.mocked(invoke);

function renderWithClient(
  ui: ReactElement,
): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { user };
}

function makeGroup(overrides: Partial<PromptGroup> = {}): PromptGroup {
  return {
    id: "group-1",
    name: "Core Prompts",
    color: null,
    icon: null,
    position: 0n,
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

describe("PromptGroupCreateDialog", () => {
  it("renders form fields when open", () => {
    renderWithClient(
      <PromptGroupCreateDialog isOpen onClose={() => undefined} />,
    );
    expect(
      screen.getByTestId("prompt-group-create-dialog-name-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompt-group-create-dialog-color-input"),
    ).toBeInTheDocument();
  });

  it("Save button is disabled when name is empty", () => {
    renderWithClient(
      <PromptGroupCreateDialog isOpen onClose={() => undefined} />,
    );
    expect(
      screen.getByTestId("prompt-group-create-dialog-save"),
    ).toBeDisabled();
  });

  it("Save button becomes enabled once name is filled", async () => {
    const { user } = renderWithClient(
      <PromptGroupCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("prompt-group-create-dialog-name-input"),
      "Мои промпты",
    );
    expect(
      screen.getByTestId("prompt-group-create-dialog-save"),
    ).not.toBeDisabled();
  });

  it("calls create_prompt_group with correct payload on submit", async () => {
    const newGroup = makeGroup({ id: "group-new", name: "Аналитика" });
    invokeMock.mockResolvedValue(newGroup);

    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <PromptGroupCreateDialog
        isOpen
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    await user.type(
      screen.getByTestId("prompt-group-create-dialog-name-input"),
      "Аналитика",
    );
    await user.click(screen.getByTestId("prompt-group-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith(newGroup);

    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_prompt_group",
    );
    expect(createCall?.[1]).toEqual({ name: "Аналитика" });
  });

  it("shows inline error on mutation failure", async () => {
    invokeMock.mockRejectedValue(new Error("сбой"));

    const { user } = renderWithClient(
      <PromptGroupCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("prompt-group-create-dialog-name-input"),
      "Название",
    );
    await user.click(screen.getByTestId("prompt-group-create-dialog-save"));

    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-group-create-dialog-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("Cancel closes without calling the mutation", async () => {
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <PromptGroupCreateDialog isOpen onClose={onClose} />,
    );

    await user.click(
      screen.getByTestId("prompt-group-create-dialog-cancel"),
    );

    expect(onClose).toHaveBeenCalled();
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_prompt_group",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("does not render content when isOpen is false", () => {
    renderWithClient(
      <PromptGroupCreateDialog isOpen={false} onClose={() => undefined} />,
    );
    expect(
      screen.queryByTestId("prompt-group-create-dialog-name-input"),
    ).toBeNull();
  });
});
