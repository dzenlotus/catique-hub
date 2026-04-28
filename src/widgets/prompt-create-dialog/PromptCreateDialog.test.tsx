import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Prompt } from "@entities/prompt";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { PromptCreateDialog } from "./PromptCreateDialog";

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

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prm-1",
    name: "Мой промпт",
    content: "Ты полезный ассистент.",
    color: null,
    shortDescription: null,
    tokenCount: null,
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

describe("PromptCreateDialog", () => {
  it("renders form fields when open", () => {
    renderWithClient(<PromptCreateDialog isOpen onClose={() => undefined} />);
    expect(
      screen.getByTestId("prompt-create-dialog-name-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompt-create-dialog-content-textarea"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompt-create-dialog-shortdesc-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prompt-create-dialog-color-input"),
    ).toBeInTheDocument();
  });

  it("Save button is disabled when required fields are empty", () => {
    renderWithClient(<PromptCreateDialog isOpen onClose={() => undefined} />);
    const saveBtn = screen.getByTestId("prompt-create-dialog-save");
    expect(saveBtn).toBeDisabled();
  });

  it("Save button is disabled when name is filled but content is empty", async () => {
    const { user } = renderWithClient(
      <PromptCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("prompt-create-dialog-name-input"),
      "Название",
    );
    expect(screen.getByTestId("prompt-create-dialog-save")).toBeDisabled();
  });

  it("Save button is disabled when content is filled but name is empty", async () => {
    const { user } = renderWithClient(
      <PromptCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("prompt-create-dialog-content-textarea"),
      "Содержимое",
    );
    expect(screen.getByTestId("prompt-create-dialog-save")).toBeDisabled();
  });

  it("Save button becomes enabled when both required fields are filled", async () => {
    const { user } = renderWithClient(
      <PromptCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("prompt-create-dialog-name-input"),
      "Название",
    );
    await user.type(
      screen.getByTestId("prompt-create-dialog-content-textarea"),
      "Содержимое",
    );
    expect(screen.getByTestId("prompt-create-dialog-save")).not.toBeDisabled();
  });

  it("calls create_prompt with correct required payload (no optional fields)", async () => {
    const newPrompt = makePrompt({ id: "prm-new", name: "Тестовый" });
    invokeMock.mockResolvedValue(newPrompt);

    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <PromptCreateDialog isOpen onClose={onClose} onCreated={onCreated} />,
    );

    await user.type(
      screen.getByTestId("prompt-create-dialog-name-input"),
      "Тестовый",
    );
    await user.type(
      screen.getByTestId("prompt-create-dialog-content-textarea"),
      "Содержимое",
    );
    await user.click(screen.getByTestId("prompt-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith(newPrompt);

    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_prompt",
    );
    expect(createCall?.[1]).toEqual({
      name: "Тестовый",
      content: "Содержимое",
    });
    // Optional fields must NOT be in payload when empty.
    expect(createCall?.[1]).not.toHaveProperty("shortDescription");
    expect(createCall?.[1]).not.toHaveProperty("color");
  });

  it("includes optional shortDescription in payload when filled", async () => {
    const newPrompt = makePrompt();
    invokeMock.mockResolvedValue(newPrompt);

    const { user } = renderWithClient(
      <PromptCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("prompt-create-dialog-name-input"),
      "Название",
    );
    await user.type(
      screen.getByTestId("prompt-create-dialog-content-textarea"),
      "Содержимое",
    );
    await user.type(
      screen.getByTestId("prompt-create-dialog-shortdesc-input"),
      "Краткое описание",
    );
    await user.click(screen.getByTestId("prompt-create-dialog-save"));

    await waitFor(() => {
      const createCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "create_prompt",
      );
      expect(createCall?.[1]).toMatchObject({ shortDescription: "Краткое описание" });
    });
  });

  it("shows inline error on mutation failure", async () => {
    invokeMock.mockRejectedValue(new Error("сбой базы данных"));

    const { user } = renderWithClient(
      <PromptCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("prompt-create-dialog-name-input"),
      "Название",
    );
    await user.type(
      screen.getByTestId("prompt-create-dialog-content-textarea"),
      "Содержимое",
    );
    await user.click(screen.getByTestId("prompt-create-dialog-save"));

    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-create-dialog-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("Cancel closes without calling the mutation", async () => {
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <PromptCreateDialog isOpen onClose={onClose} />,
    );

    await user.click(screen.getByTestId("prompt-create-dialog-cancel"));

    expect(onClose).toHaveBeenCalled();
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_prompt",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("does not render content when isOpen is false", () => {
    renderWithClient(
      <PromptCreateDialog isOpen={false} onClose={() => undefined} />,
    );
    expect(
      screen.queryByTestId("prompt-create-dialog-name-input"),
    ).toBeNull();
  });
});
